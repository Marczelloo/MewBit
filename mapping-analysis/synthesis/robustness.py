"""Stage 3 robustness check: do the generator's rhythm gaps survive the most lenient reading of its timing?

    python3 -I synthesis/robustness.py [--shared shared] [--work data] [--out synthesis/out]

Every generator moment is moved to the coarsest human-grid point (1/1, 1/2, 1/4, 1/3, 1/8, 1/6, in that order) within
25 ms, i.e. anywhere in the game's PERFECT window (40 ms). Then the official metrics are measured again as if the chart
were placed exactly (kind="human"). If a conclusion holds under this reading it cannot be a jitter artefact.
Reported per level against the human charts of the same test songs: beat and half-beat coverage, 1/2 and off-class
gaps, longest 1/2 run, repetition rhythm and its baseline.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "pipeline" / "osu"), str(ROOT / "pipeline" / "metrics"), str(ROOT / "synthesis")]
import audio_metrics as am  # noqa: E402
import chart_metrics as cm  # noqa: E402
from cross_levels import grid_of  # noqa: E402

LEVELS = ("easy", "normal", "hard")
ORDER = (1, 2, 4, 3, 8, 6)
REACH_MS = 25.0


def lenient(notes: list[cm.N], grid) -> list[cm.N]:
    out = []
    for n in notes:
        best = None
        for d in ORDER:
            pos, i = grid.local_pos(n.t)
            p = grid.reds[i]
            t = p.t + round(pos * d) / d * p.beat_length
            if abs(t - n.t) <= REACH_MS:
                best = t
                break
        shift = (best - n.t) if best is not None else 0.0
        out.append(cm.N(int(round(n.t + shift)), n.lane, int(round(n.end + shift)) if n.hold else None))
    # two notes of one lane snapped onto one time: keep one
    seen, dedup = set(), []
    for n in sorted(out, key=lambda n: (n.t, n.lane)):
        if (n.t, n.lane) not in seen:
            seen.add((n.t, n.lane))
            dedup.append(n)
    return dedup


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "synthesis" / "out")
    args = ap.parse_args(argv)
    corpus = {r["set_id"]: r for r in csv.DictReader(open(args.shared / "corpus.csv", encoding="utf-8"))}
    bias = json.loads((args.shared / "onset_bias.json").read_text())["bias_ms"]
    keys = [("coverage", "beat"), ("coverage", "half"), ("gap_share", "1/2"), ("gap_share", "other"), ("run_1/2", "max_notes")]
    summary = {}
    for level in LEVELS:
        rows = []
        for p in sorted((args.shared / "data" / level / "notes").glob("algo_*.json")):
            sid = p.stem.split("_", 1)[1]
            human_p = args.shared / "data" / level / "notes" / f"human_{sid}.json"
            if not human_p.exists():
                continue
            song = json.loads((args.shared / "data" / "songs" / f"{sid}.json").read_text())
            grid = grid_of(corpus[sid], song, args.work / "osz")
            npz = dict(np.load(args.work / "librosa" / f"{sid}.npz"))
            to_n = lambda rows_: sorted((cm.N(int(t), int(l), int(e) if e is not None else None) for t, l, e in rows_), key=lambda n: (n.t, n.lane))
            algo = to_n(json.loads(p.read_text())["notes"])
            human = to_n(json.loads(human_p.read_text())["notes"])
            snapped = lenient(algo, grid)
            r = {"set_id": sid}
            for who, notes, kind in (("human", human, "human"), ("algo_v2", algo, "algo"), ("algo_lenient", snapped, "human")):
                m = cm.chart_metrics(notes, grid, kind=kind)
                span = (float(notes[0].t), float(max(n.end if n.hold else n.t for n in notes)) + 1)
                rep = am.repetition_metrics(notes, grid, npz, span, kind=kind)
                for a, b in keys:
                    r[f"{who}.{a}.{b}"] = (m.get(a) or {}).get(b, 0.0)
                r[f"{who}.rep.rhythm"] = (rep.get("repeat") or {}).get("rhythm")
                r[f"{who}.rep.baseline"] = (rep.get("baseline") or {}).get("rhythm")
            rows.append(r)
        med = {k: float(np.nanmedian([r[k] if r[k] is not None else np.nan for r in rows])) for k in rows[0] if k != "set_id"}
        summary[level] = {"songs": len(rows), **med}
        print(level, f"n={len(rows)}")
        for metric in [f"{a}.{b}" for a, b in keys] + ["rep.rhythm", "rep.baseline"]:
            print(f"  {metric:20s} human {med['human.' + metric]:6.2f} | algo v2 {med['algo_v2.' + metric]:6.2f} | algo ±25 ms {med['algo_lenient.' + metric]:6.2f}")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "robustness_summary.json").write_text(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
