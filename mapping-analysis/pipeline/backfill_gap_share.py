"""Brings stored chart metrics up to the v2.1 gap_share (every gap class present, absent ones 0), without a pipeline run.

    python3 -I pipeline/backfill_gap_share.py [--shared shared] [--work data] [--verify]

Before v2.1, chart_metrics wrote only the gap classes a chart had, so a class a chart lacked became an empty cell in
the aggregated tables and medians skipped those charts. Adding the missing classes as 0 is exactly what the fixed code
computes (the shares of the present classes do not change). --verify recomputes gap_share from the notes with the fixed
code for every chart (human charts on their shifted grid, generator charts on the human grid of their level) and fails
on any difference. Run pipeline/aggregate.py afterwards.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "pipeline" / "osu"), str(ROOT / "pipeline" / "metrics"), str(ROOT / "synthesis")]
import chart_metrics as cm  # noqa: E402

LEVELS = ("easy", "normal", "hard")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args(argv)
    changed = files = 0
    for level in LEVELS:
        for who in ("human", "algo"):
            for p in sorted((args.shared / "data" / level / who).glob("*.json")):
                m = json.loads(p.read_text())
                if not m.get("valid", True) or "gap_share" not in m:
                    continue
                files += 1
                filled = {k: m["gap_share"].get(k, 0.0) for k in cm.GAP_LABELS}
                if filled != m["gap_share"]:
                    m["gap_share"] = filled
                    p.write_text(json.dumps(m))
                    changed += 1
    print(f"{files} chart metric files, {changed} backfilled")
    if not args.verify:
        return 0
    from cross_levels import grid_of  # noqa: PLC0415 - needs the .osz files, only for --verify

    corpus = {r["set_id"]: r for r in csv.DictReader(open(args.shared / "corpus.csv", encoding="utf-8"))}
    checked = mismatched = 0
    for level in LEVELS:
        for p in sorted((args.shared / "data" / level / "notes").glob("*.json")):
            who, sid = p.stem.split("_", 1)
            stored = json.loads((args.shared / "data" / level / who / f"{sid}.json").read_text())
            if not stored.get("valid", True):
                continue
            song = json.loads((args.shared / "data" / "songs" / f"{sid}.json").read_text())
            grid = grid_of(corpus[sid], song, args.work / "osz")
            notes = sorted((cm.N(int(t), int(l), int(e) if e is not None else None) for t, l, e in json.loads(p.read_text())["notes"]),
                           key=lambda n: (n.t, n.lane))
            fresh = cm.chart_metrics(notes, grid, kind=who)["gap_share"]
            checked += 1
            if set(fresh) != set(stored["gap_share"]) or any(abs(fresh[k] - stored["gap_share"][k]) > 1e-9 for k in fresh):
                mismatched += 1
                print(f"MISMATCH {level} {who} {sid}")
    print(f"verified {checked} charts against a fresh computation: {mismatched} differ")
    return 1 if mismatched else 0


if __name__ == "__main__":
    raise SystemExit(main())
