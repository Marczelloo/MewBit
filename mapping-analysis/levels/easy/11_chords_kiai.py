"""Where Easy chords and holds sit: in kiai vs outside, on downbeats vs other beats, on loud vs quiet beats (slot tables)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import metrics, qstr, slots

h = metrics("human")
a = metrics("algo")


def stats(who, sid):
    z = slots(who, sid)
    m = z["mapped"]
    ch = z["n_notes"] >= 2
    k = z["kiai"]
    db = z["downbeat"]
    beat = z["snap"] == 1
    r = {}
    if (m & k).sum() >= 10 and (m & ~k).sum() >= 10:
        r["chord_rate_kiai"] = ch[m & k].mean()
        r["chord_rate_nokiai"] = ch[m & ~k].mean()
        r["hold_rate_kiai"] = z["hold_start"][m & k].mean()
        r["hold_rate_nokiai"] = z["hold_start"][m & ~k].mean()
    r["chord_rate_downbeat"] = ch[m & db].mean() if (m & db).sum() else np.nan
    r["chord_rate_otherbeat"] = ch[m & beat & ~db].mean() if (m & beat & ~db).sum() else np.nan
    # loud vs quiet mapped beats (rms above / below the song's median)
    med = np.median(z["rms"])
    r["chord_rate_loud"] = ch[m & (z["rms"] >= med)].mean()
    r["chord_rate_quiet"] = ch[m & (z["rms"] < med)].mean()
    # mapped share of beats in kiai vs outside
    if (beat & k).sum() >= 10:
        r["beat_mapped_kiai"] = m[beat & k].mean()
        r["beat_mapped_nokiai"] = m[beat & ~k].mean()
        half = z["snap"] == 2
        r["half_mapped_kiai"] = m[half & k].mean()
        r["half_mapped_nokiai"] = m[half & ~k].mean()
    return r


for name, df, who in [("humans train", h[h.split == "train"], "human"), ("humans test", h[h.split == "test"], "human"), ("generator", a, "algo")]:
    S = pd.DataFrame([stats(who, s) for s in df.set_id])
    print(f"\n== {name}")
    for c in S.columns:
        print(f"  {c}: {qstr(S[c])} (n={S[c].notna().sum()})")
    if "chord_rate_kiai" in S:
        d = S.dropna(subset=["chord_rate_kiai"])
        print(f"  maps with more chords in kiai: {(d.chord_rate_kiai > d.chord_rate_nokiai).sum()}/{len(d)}; more 1/2 in kiai: {(d.half_mapped_kiai > d.half_mapped_nokiai).sum()}/{d.half_mapped_kiai.notna().sum()}")
