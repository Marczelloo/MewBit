"""Diagnostics (not new metrics): how much of the human Easy rhythm the generator's fixed Easy floors would forbid
(minNoteGapMs 200, minLaneGapMs 350 from the end of a hold, laneGapBeats 1), and the sound under hold starts vs taps
(slot table, `chosen`). Hold length, start on beat and release at the next moment are official since metrics v2
(hold_short_share, holds_context.*): see 07_algo_vs_human.py. Prints per-map quantiles."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import OUT, metrics, notes, q, qstr, slots

h = metrics("human")
a = metrics("algo")
DET = ["perc", "harm", "lowmid", "stem_drums", "stem_bass", "stem_vocals", "stem_other"]


def bpm_at(z, t):
    i = np.searchsorted(z["t"], t)
    i = min(max(i, 0), len(z["t"]) - 1)
    return z["bpm"][i]


def diag(who, sid):
    ns = notes(who, sid)
    z = slots(who, sid)
    times = np.array(sorted({n[0] for n in ns}), dtype=float)
    gaps = np.diff(times)
    r = {"set_id": sid}
    r["gap_lt_200ms"] = float(np.mean(gaps < 200 - 1)) if len(gaps) else np.nan
    # same lane, from the end of the previous note/hold of that lane
    lane_gaps = []
    for lane in range(4):
        ln = sorted([n for n in ns if n[1] == lane])
        for p, c in zip(ln, ln[1:]):
            end = p[2] if p[2] is not None else p[0]
            lane_gaps.append((c[0] - end, c[0] - p[0], bpm_at(z, c[0])))
    lg = np.array(lane_gaps) if lane_gaps else np.zeros((0, 3))
    r["lane_gap_lt_350ms"] = float(np.mean(lg[:, 0] < 350 - 1)) if len(lg) else np.nan
    r["lane_gap_lt_1beat"] = float(np.mean(lg[:, 1] < 0.9 * 60000 / lg[:, 2])) if len(lg) else np.nan
    holds = [n for n in ns if n[2] is not None]
    r["n_holds"] = len(holds)
    # features at hold starts vs other mapped slots (beats only, so position does not confound)
    hs = z["hold_start"] & (z["snap"] == 1)
    ms = z["mapped"] & ~z["hold_start"] & (z["snap"] == 1)
    for d in DET:
        if hs.sum() >= 3 and ms.sum() >= 3:
            r[f"hold_minus_tap_env_{d}"] = float(z[f"env_{d}"][hs].mean() - z[f"env_{d}"][ms].mean())
    if hs.sum() >= 3:
        r["hold_rms_minus_tap"] = float(z["rms"][hs].mean() - z["rms"][ms].mean())
    return r


H = pd.DataFrame([diag("human", s) for s in h.set_id]).merge(h[["set_id", "split", "owner", "genre_g"]], on="set_id")
A = pd.DataFrame([diag("algo", s) for s in a.set_id])
H.to_csv(OUT / "holds_floors_human.csv", index=False)
A.to_csv(OUT / "holds_floors_algo.csv", index=False)
for name, df in [("humans train", H[H.split == "train"]), ("humans test", H[H.split == "test"]), ("generator test", A)]:
    print(f"\n== {name}: n={len(df)}")
    for c in [c for c in df.columns if c not in ("set_id", "split", "owner", "genre_g")]:
        print(f"  {c}: {qstr(df[c])}  (maps with value: {df[c].notna().sum()})")
