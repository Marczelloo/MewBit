"""Compares a fresh pipeline run with the committed baseline, by the criteria of HANDOFF.md section 5.

    python3 -I pipeline/compare_baseline.py --run <--shared of the run> --split test|train [--out <dir>]

Checks, for the sets the run covers:
  1. the notes of every generator and human chart against shared/cross/ (the generator is deterministic, so any
     difference comes from the DSP features: audio decoding or the JDK);
  2. n_notes in the generator's and the humans' metrics tables;
  3. for --split test only, level_distance.py against synthesis/out: panel metrics within 0.05 IQR, precision and
     recall within 0.02. The human IQR comes from all human charts of a level, so sets the run does not cover keep their
     committed rows; that is what lets a run of the 20 test songs reproduce the table.
Exits 0 when every check holds.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "synthesis"))

import level_distance  # noqa: E402

LEVELS = level_distance.LEVELS
PANEL_TOLERANCE = 0.05
VERSUS_TOLERANCE = 0.02
# Distance to the onsets of every detector, stems included when a run has them; the committed baseline has them, so a
# run without stems cannot match it here, and only here. Compare runs without stems with each other.
STEM_DEPENDENT = "alignment.no_sound_share"


def compare_charts(run: Path, baseline: Path, sets: list[str], split: str) -> list[str]:
    """Differences in the notes. Committed generator charts exist for test songs only, and a train run skips those, so it compares humans alone."""
    problems, identical, compared = [], 0, 0
    sources = ("human", "algo") if split == "test" else ("human",)
    for sid in sets:
        mine = json.loads((run / "cross" / f"{sid}.json").read_text())
        theirs = json.loads((baseline / "cross" / f"{sid}.json").read_text())
        for source in sources:
            for level, notes in theirs.get(source, {}).items():
                compared += 1
                ours = mine.get(source, {}).get(level)
                if ours == notes:
                    identical += 1
                elif ours is None:
                    problems.append(f"{sid} {source} {level}: missing from the run")
                else:
                    first = next((i for i, (a, b) in enumerate(zip(ours, notes)) if a != b), min(len(ours), len(notes)))
                    problems.append(f"{sid} {source} {level}: {len(ours)} notes, committed {len(notes)}; first difference at note {first}")
    print(f"charts: {identical}/{compared} identical to shared/cross ({split})")
    return problems


def compare_note_counts(run: Path, baseline: Path, sets: list[str]) -> list[str]:
    problems = []
    for level in LEVELS:
        for who in ("human", "algo"):
            base_path, run_path = baseline / "data" / level / f"{who}_metrics.csv", run / "data" / level / f"{who}_metrics.csv"
            if not run_path.exists():
                continue
            ours = pd.read_csv(run_path, usecols=["set_id", "n_notes"], dtype={"set_id": str}).set_index("set_id")["n_notes"]
            theirs = pd.read_csv(base_path, usecols=["set_id", "n_notes"], dtype={"set_id": str}).set_index("set_id")["n_notes"]
            shared = ours.index.intersection(theirs.index).intersection(sets)
            diff = ours.loc[shared][ours.loc[shared] != theirs.loc[shared]]
            print(f"n_notes {level} {who}: {len(shared) - len(diff)}/{len(shared)} equal")
            problems += [f"{sid} {level} {who}: n_notes {int(ours[sid])}, committed {int(theirs[sid])}" for sid in diff.index]
    return problems


def merged_shared(run: Path, baseline: Path, out: Path) -> Path:
    """A --shared folder for level_distance: the run's rows, plus committed human rows of the sets the run left out."""
    merged = out / "merged"
    for level in LEVELS:
        folder = merged / "data" / level
        folder.mkdir(parents=True, exist_ok=True)
        human = pd.read_csv(run / "data" / level / "human_metrics.csv", low_memory=False)
        committed = pd.read_csv(baseline / "data" / level / "human_metrics.csv", low_memory=False)
        rest = committed[~committed["set_id"].isin(human["set_id"])]
        pd.concat([human, rest], ignore_index=True).to_csv(folder / "human_metrics.csv", index=False)
        shutil.copy(run / "data" / level / "algo_metrics.csv", folder / "algo_metrics.csv")
    return merged


def compare_panel(merged: Path, out: Path, split: str, has_stems: bool) -> list[str]:
    table_dir = out / "synthesis"
    level_distance.main(["--shared", str(merged), "--out", str(table_dir), "--split", split])
    if split != "test":
        return []
    problems = []
    ours = pd.read_csv(table_dir / "level_distance.csv").set_index(["level", "metric"])
    theirs = pd.read_csv(ROOT / "synthesis" / "out" / "level_distance.csv").set_index(["level", "metric"])
    delta = (ours["distance_iqr_p50"] - theirs["distance_iqr_p50"]).abs()
    if not has_stems:
        print("run without stems:", {k[0]: round(v, 3) for k, v in delta.items() if k[1] == STEM_DEPENDENT}, f"IQR on {STEM_DEPENDENT}, not checked")
        delta = delta[delta.index.get_level_values("metric") != STEM_DEPENDENT]
    print(f"panel: largest metric difference {delta.max():.4f} IQR at {delta.idxmax()}")
    problems += [f"{key}: panel differs by {value:.3f} IQR" for key, value in delta.items() if value > PANEL_TOLERANCE]
    summary_ours = json.loads((table_dir / "level_distance_summary.json").read_text())
    summary_theirs = json.loads((ROOT / "synthesis" / "out" / "level_distance_summary.json").read_text())
    for level in LEVELS:
        for key, tolerance in (("per_song_distance_iqr_p50", PANEL_TOLERANCE), ("median_distance_iqr", PANEL_TOLERANCE),
                               ("precision_p50", VERSUS_TOLERANCE), ("recall_p50", VERSUS_TOLERANCE)):
            a, b = summary_ours[level][key], summary_theirs[level][key]
            print(f"{level} {key}: {a:.4f} (committed {b:.4f})")
            if abs(a - b) > tolerance:
                problems.append(f"{level} {key}: {a:.3f}, committed {b:.3f}")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--baseline", type=Path, default=ROOT / "shared")
    ap.add_argument("--split", required=True, choices=["test", "train"])
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    out = args.out or args.run / "compare"
    sets = sorted(p.stem for p in (args.run / "cross").glob("*.json"))
    print(f"run covers {len(sets)} sets")
    problems = compare_charts(args.run, args.baseline, sets, args.split)
    problems += compare_note_counts(args.run, args.baseline, sets)
    columns = pd.read_csv(args.run / "data" / "hard" / "algo_metrics.csv", nrows=0).columns
    problems += compare_panel(merged_shared(args.run, args.baseline, out), out, args.split, "alignment.stem_drums.share" in columns)
    print(f"{len(problems)} differences beyond tolerance")
    for line in problems:
        print(" ", line)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
