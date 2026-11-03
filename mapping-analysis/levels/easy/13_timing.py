"""How far the generator's moments sit from the nearest human grid slot (every 1/8 and 1/6 beat of the human map),
in ms and as a share of a beat; and the share that would fall into a neighbouring 1/24-beat cell (the resolution of
repetition.*.rhythm), i.e. more than 1/48 beat away. Also the signed median (generator early < 0)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import metrics, notes, qstr, slots

rows = []
for who, df in [("human", metrics("human")), ("algo", metrics("algo"))]:
    for _, r in df.iterrows():
        if who == "human" and r.split != "test":
            continue
        z = slots("human", r.set_id)
        t = np.array(sorted({n[0] for n in notes(who, r.set_id)}), float)
        i = np.clip(np.searchsorted(z["t"], t), 1, len(z["t"]) - 1)
        left, right = z["t"][i - 1], z["t"][i]
        near = np.where(np.abs(left - t) <= np.abs(right - t), left, right)
        d = t - near
        beat = 60000 / z["bpm"][i]
        rows.append({"who": who, "set_id": r.set_id, "abs_p50_ms": np.median(np.abs(d)), "abs_p90_ms": np.quantile(np.abs(d), 0.9),
                     "signed_p50_ms": np.median(d), "gt_10ms": np.mean(np.abs(d) > 10), "gt_1_48_beat": np.mean(np.abs(d) > beat / 48)})
R = pd.DataFrame(rows)
for who, d in R.groupby("who"):
    print(who, len(d), {c: qstr(d[c]) for c in ["abs_p50_ms", "abs_p90_ms", "signed_p50_ms", "gt_10ms", "gt_1_48_beat"]})
print(R[R.who == "algo"].sort_values("gt_10ms").to_string(index=False, float_format=lambda v: f"{v:.2f}"))
