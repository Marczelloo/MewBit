"""Diagnostics (not new metrics): holds in detail, and how much of the human Easy rhythm the generator's fixed Easy
floors would forbid (minNoteGapMs 200, minLaneGapMs 350 from the end of a hold, laneGapBeats 1, the felt beat).
Reads notes and slot tables only. Prints per-map quantiles."""
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
    if holds:
        lens = np.array([(n[2] - n[0]) * bpm_at(z, n[0]) / 60000 for n in holds])
        r["hold_lt_0.9b"] = float(np.mean(lens < 0.9))
        r["hold_len_p50"] = float(np.median(lens))
        # hold start position: on a beat / downbeat of the human grid
        idx = np.searchsorted(z["t"], [n[0] for n in holds])
        idx = np.clip(idx, 0, len(z["t"]) - 1)
        snap = z["snap"][idx]
        r["hold_start_on_beat"] = float(np.mean(snap == 1))
        # what comes right after a release: next moment's distance from the release, in beats
        nxt = []
        for n in holds:
            later = times[times > n[0]]
            later = later[later >= n[2] - 5]
            if len(later):
                nxt.append((later[0] - n[2]) * bpm_at(z, n[0]) / 60000)
        r["next_after_release_p50"] = float(np.median(nxt)) if nxt else np.nan
        r["next_at_release_share"] = float(np.mean(np.abs(np.array(nxt)) < 0.05)) if nxt else np.nan
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
