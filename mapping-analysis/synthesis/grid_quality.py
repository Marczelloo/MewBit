"""How well the generator's beat grid matches the humans', song by song: the grid criteria of REPORT.md part 6.

    python3 -I synthesis/grid_quality.py --shared <shared of a run> --split train|test|all --out <dir>

Reads algo_beat_tracking from <shared>/data/songs. Writes grid_quality.csv and grid_quality_summary.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
# The generator's beat is twice the human beat when the humans' beat fits about 0.5 times into it.
HALF_TEMPO = (0.45, 0.55)
GOOD_BEAT, GOOD_PHASE, BAD_PHASE = 0.85, 0.8, 0.3


def song_row(path: Path) -> dict:
    song = json.loads(path.read_text())
    tracking = song.get("algo_beat_tracking") or {}
    return {
        "set_id": song["set_id"], "split": song.get("split"), "genre": song.get("genre"), "human_bpm": song.get("main_bpm"),
        "algo_bpm": (song.get("algo_tempo") or {}).get("bpm"), "has_grid": bool(tracking.get("snapped")),
        "beat_ratio": tracking.get("human_beat_over_algo_beat"), "fold_factor": tracking.get("fold_factor"),
        "on_human_beat": tracking.get("on_human_beat_share"), "on_human_half": tracking.get("on_human_half_not_beat_share"),
        "phase": tracking.get("downbeat_on_human_downbeat_share"),
    }


def summarize(table: pd.DataFrame) -> dict:
    grid = table[table["has_grid"]]
    phased = grid["phase"].dropna()
    ratio = grid["beat_ratio"]
    return {
        "songs": len(table),
        "with_grid": len(grid),
        "half_tempo": int(ratio.between(*HALF_TEMPO).sum()),
        "on_human_beat_ge_0_85": int((grid["on_human_beat"] >= GOOD_BEAT).sum()),
        "phase_measured": len(phased),
        "phase_ge_0_8": int((phased >= GOOD_PHASE).sum()),
        "phase_lt_0_3": int((phased < BAD_PHASE).sum()),
        "on_human_beat_p50": float(grid["on_human_beat"].median()),
        "phase_p50": float(phased.median()),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--split", default="train", choices=["train", "test", "all"])
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    table = pd.DataFrame([song_row(p) for p in sorted((args.shared / "data" / "songs").glob("*.json"))])
    if args.split != "all":
        table = table[table["split"] == args.split]
    summary = summarize(table)
    args.out.mkdir(parents=True, exist_ok=True)
    table.to_csv(args.out / "grid_quality.csv", index=False)
    (args.out / "grid_quality_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
