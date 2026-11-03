"""Auxiliary checks of RC Easy guidelines that no shared metric covers (not official metrics; see REPORT.md,
"Prośby o nowe metryki"): chords inside runs of consecutive 1/2 (both neighbouring gaps 1/2 beat), and the BPM at which
the longest 1/2 run exceeds 5 notes. Gaps in beats use the local BPM from the human slot table."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import metrics, notes, qstr, slots

h = metrics("human")
a = metrics("algo")


def check(who, sid, drain_s):
    ns = notes(who, sid)
    z = slots("human", sid)  # the human grid for both
    times = np.array(sorted({n[0] for n in ns}), float)
    size = {t: 0 for t in times}
    for n in ns:
        size[n[0]] += 1
    bpm = z["bpm"][np.clip(np.searchsorted(z["t"], times), 0, len(z["t"]) - 1)]
    gaps = np.diff(times) * bpm[1:] / 60000
    half = np.abs(gaps - 0.5) <= 0.03
    inside = 0
    chords = 0
    for i in range(1, len(times) - 1):
        if size[times[i]] >= 2:
            chords += 1
            if half[i - 1] and half[i]:
                inside += 1
    return {"set_id": sid, "chords_in_half_run_per_min": inside / (drain_s / 60), "chords_in_half_run_share": inside / max(1, chords)}


for name, df, who in [("humans train", h[h.split == "train"], "human"), ("humans test", h[h.split == "test"], "human"), ("generator", a, "algo")]:
    R = pd.DataFrame([check(who, r.set_id, r.drain_s) for _, r in df.iterrows()])
    print(f"{name}: chords inside 1/2 runs per min {qstr(R.chords_in_half_run_per_min)}, share of chords {qstr(R.chords_in_half_run_share)}, maps with none {(R.chords_in_half_run_per_min == 0).sum()}/{len(R)}")
