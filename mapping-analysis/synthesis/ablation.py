"""Stage 3 sensitivity check: which of the generator's level parameters hold Easy and Normal back?

    python3 -I synthesis/ablation.py [--shared shared] [--work data] [--out synthesis/out]

For the 20 test songs, regenerates one level with parameter overrides (ablation_generate.js, in memory; the repository's
generator is not changed) and measures the charts against the human chart of the same song and level: density ratio,
beat and half-beat coverage, 1/2 gaps, longest 1/2 run, chords, and precision / recall of moments. Each level's
parameters are independent, so an override here cannot change another level's charts; changes to shared functions
(timing, holds, patterns) are not tested here.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "pipeline" / "osu"), str(ROOT / "pipeline" / "metrics"), str(ROOT / "synthesis")]
import audio_metrics as am  # noqa: E402
import chart_metrics as cm  # noqa: E402
from cross_levels import grid_of  # noqa: E402

VARIANTS = {
    "normal": {
        "v19 (dziś)": {},
        "maxNps 6.5 / sufit 7.5": {"maxNps": 6.5, "maxNpsCeiling": 7.5},
        "bez maxFastRun, maxQuarterShare, quarterMinEnergy": {"maxFastRun": "__delete__", "maxQuarterShare": "__delete__", "quarterMinEnergy": None},
        "gapBeats 1/8 (zamiast 1/4)": {"gapBeats": 0.125},
        "wszystkie trzy razem": {"maxNps": 6.5, "maxNpsCeiling": 7.5, "maxFastRun": "__delete__", "maxQuarterShare": "__delete__",
                                 "quarterMinEnergy": None, "gapBeats": 0.125},
    },
    "easy": {
        "v19 (dziś)": {},
        "minNoteGapMs 130 (zamiast 200)": {"minNoteGapMs": 130},
        "maxNps 4 / sufit 4.5": {"maxNps": 4.0, "maxNpsCeiling": 4.5},
        "obie zmiany": {"minNoteGapMs": 130, "maxNps": 4.0, "maxNpsCeiling": 4.5},
        "obie + gapBeats 1/4 (zamiast 1/2)": {"minNoteGapMs": 130, "maxNps": 4.0, "maxNpsCeiling": 4.5, "gapBeats": 0.25, "tonalGapBeats": 0.25},
        "maxLevel 1 (słabsze uderzenia też)": {"maxLevel": 1},
        "maxLevel 1 + minNoteGapMs 130 + maxNps 4 / sufit 4.5": {"maxLevel": 1, "minNoteGapMs": 130, "maxNps": 4.0, "maxNpsCeiling": 4.5},
    },
}


def to_n(rows):
    return sorted((cm.N(int(t), int(l), int(e) if e is not None else None) for t, l, e in rows), key=lambda n: (n.t, n.lane))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "synthesis" / "out")
    args = ap.parse_args(argv)
    corpus = {r["set_id"]: r for r in csv.DictReader(open(args.shared / "corpus.csv", encoding="utf-8"))}
    test = [sid for sid, r in corpus.items() if r["split"] == "test"]
    results = {}
    with tempfile.TemporaryDirectory() as tmp:
        for level, variants in VARIANTS.items():
            results[level] = {}
            for name, overrides in variants.items():
                rows = []
                for sid in test:
                    hp = args.shared / "data" / level / "notes" / f"human_{sid}.json"
                    if not hp.exists():
                        continue
                    out = Path(tmp) / f"{level}_{abs(hash(name))}_{sid}.json"
                    subprocess.run(["node", str(ROOT / "synthesis" / "ablation_generate.js"), str(args.work / "features" / f"{sid}.json"), str(out), level,
                                    json.dumps(overrides)], check=True, capture_output=True)
                    chart = json.loads(out.read_text())["chart"]
                    if not chart:
                        continue
                    song = json.loads((args.shared / "data" / "songs" / f"{sid}.json").read_text())
                    grid = grid_of(corpus[sid], song, args.work / "osz")
                    algo = cm.from_mewbeat(chart)
                    human = to_n(json.loads(hp.read_text())["notes"])
                    ma, mh = cm.chart_metrics(algo, grid, kind="algo"), cm.chart_metrics(human, grid, kind="human")
                    vs = am.versus_human(algo, human, grid)
                    rows.append({
                        "density_ratio": ma["notes_per_beat"] / mh["notes_per_beat"],
                        "beat_cov": ma["coverage"]["beat"], "half_cov": ma["coverage"]["half"],
                        "gap_1/2": ma["gap_share"].get("1/2", 0.0), "run_1/2_max": ma["run_1/2"]["max_notes"],
                        "chord_share": ma["chord_share"], "gap_ms_min": ma["gap_ms"]["min"],
                        "precision": vs["precision"], "recall": vs["recall"],
                        "human_beat_cov": mh["coverage"]["beat"], "human_half_cov": mh["coverage"]["half"],
                        "human_gap_1/2": mh["gap_share"].get("1/2", 0.0), "human_run_1/2_max": mh["run_1/2"]["max_notes"],
                        "human_chord_share": mh["chord_share"],
                    })
                med = {k: float(np.median([r[k] for r in rows])) for k in rows[0]}
                results[level][name] = {"songs": len(rows), **med}
                print(f"{level:6s} {name:52s} n={len(rows)} density {med['density_ratio']:.2f} beat {med['beat_cov']:.2f} (h {med['human_beat_cov']:.2f}) "
                      f"half {med['half_cov']:.2f} (h {med['human_half_cov']:.2f}) 1/2 {med['gap_1/2']:.2f} (h {med['human_gap_1/2']:.2f}) "
                      f"run {med['run_1/2_max']:.0f} (h {med['human_run_1/2_max']:.0f}) chords {med['chord_share']:.2f} (h {med['human_chord_share']:.2f}) "
                      f"P {med['precision']:.2f} R {med['recall']:.2f}", flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "ablation_summary.json").write_text(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
