"""Flattens per-chart metrics into one table per level and source (input for the stage-2 analyses).

    python3 -I pipeline/aggregate.py [--shared shared] [--corpus shared/corpus.csv]

Writes shared/data/<level>/human_metrics.csv and shared/data/<level>/algo_metrics.csv: one row per chart, nested
metrics as dotted columns (e.g. snap_share.4, alignment.full.share), joined with the corpus columns the analyses split
by (split, genre, genre_source, year, period, bpm, bpm_bin, creator, level stars) and the level-independent song facts
(variable BPM, meters, timing consistency). Lists (boundary rows, lane shares) become one column per item or are
left out; nothing from another level is joined in.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "normal", "hard")
CORPUS_COLS = ("split", "genre", "genre_source", "year", "period", "bpm", "bpm_bin", "creator", "full_set")
SONG_COLS = ("variable_bpm", "meters", "timing_consistent", "main_bpm", "red_lines")


def flatten(d: dict, prefix: str = "", out: dict | None = None) -> dict:
    out = {} if out is None else out
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            flatten(v, key + ".", out)
        elif isinstance(v, list):
            if v and all(isinstance(x, (int, float)) for x in v) and len(v) <= 8:
                for i, x in enumerate(v):
                    out[f"{key}.{i}"] = x
        else:
            out[key] = v
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--corpus", type=Path)
    args = ap.parse_args(argv)
    corpus_path = args.corpus or args.shared / "corpus.csv"
    with open(corpus_path, newline="", encoding="utf-8") as f:
        corpus = {r["set_id"]: r for r in csv.DictReader(f)}
    for level in LEVELS:
        for who in ("human", "algo"):
            folder = args.shared / "data" / level / who
            rows = []
            for p in sorted(folder.glob("*.json")) if folder.exists() else []:
                m = json.loads(p.read_text())
                sid = str(m.get("set_id", p.stem))
                row = {"set_id": sid, "level": level, "source": who}
                c = corpus.get(sid, {})
                row.update({k: c.get(k) for k in CORPUS_COLS})
                row["stars"] = c.get(f"{level}_stars")
                song_path = args.shared / "data" / "songs" / f"{sid}.json"
                if song_path.exists():
                    s = json.loads(song_path.read_text())
                    row.update({f"song.{k}": (json.dumps(s.get(k)) if isinstance(s.get(k), list) else s.get(k)) for k in SONG_COLS})
                row.update(flatten({k: v for k, v in m.items() if k not in ("set_id",)}))
                rows.append(row)
            if not rows:
                continue
            cols = list(dict.fromkeys(k for r in rows for k in r))
            out = args.shared / "data" / level / f"{who}_metrics.csv"
            with open(out, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=cols)
                w.writeheader()
                w.writerows(rows)
            print(f"{out}: {len(rows)} charts, {len(cols)} columns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
