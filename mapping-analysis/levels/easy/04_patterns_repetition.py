"""Patterns (lanes, steps, trills, stairs, entropy) and repetition when the music repeats, Easy.
Humans train/test; the generator on the test songs, paired with the human map of the same song."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from common import OUT, metrics, q, qstr

h = metrics("human")
a = metrics("algo")
for df in (h, a):
    df["rep_rhythm_gain"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]
    df["rep_lanes_gain"] = df["repetition.repeat.lanes"] - df["repetition.baseline.lanes"]
    df["rep_mirror_gain"] = df["repetition.repeat.lanes_or_mirror"] - df["repetition.baseline.lanes_or_mirror"]
    df["inner_share"] = df["lane_share.1"] + df["lane_share.2"]
    df["outer_share"] = df["lane_share.0"] + df["lane_share.3"]

cols = ["inner_share", "left_hand_share", "single_step_share.0", "single_step_share.1", "single_step_share.2", "single_step_share.3",
        "hand_switch_share", "trill_share", "stair_share", "pattern4_entropy_bits", "pattern4_distinct_per_100", "minijack_share",
        "minijack_gap_beats.p50", "jack_max_notes", "anchor_max_notes", "chord_share", "chord2_split_hands_share",
        "chord_position_share.downbeat", "chord_position_share.beat", "chord_position_share.offbeat",
        "repetition.repeat_pairs", "repetition.repeat.rhythm", "repetition.baseline.rhythm", "rep_rhythm_gain",
        "repetition.repeat.lanes", "repetition.baseline.lanes", "rep_lanes_gain", "repetition.repeat.lanes_or_mirror", "rep_mirror_gain",
        "repetition.sweep.0.85.identity.rhythm", "repetition.sweep.0.90.identity.rhythm"]
tr, te = h[h.split == "train"], h[h.split == "test"]
rows = []
for c in cols:
    pair = te[["set_id", c]].merge(a[["set_id", c]], on="set_id", suffixes=("_h", "_a")).dropna()
    try:
        p = wilcoxon(pair[c + "_h"], pair[c + "_a"]).pvalue if len(pair) >= 6 else np.nan
    except ValueError:
        p = np.nan
    rows.append({"metric": c, "train n": tr[c].notna().sum(), "train p10/p50/p90": qstr(tr[c]),
                 "test p10/p50/p90": qstr(te[c]), "algo p10/p50/p90": qstr(a[c]), "paired n": len(pair),
                 "algo>human (of pairs)": int((pair[c + "_a"] > pair[c + "_h"]).sum()), "wilcoxon p": p})
res = pd.DataFrame(rows)
pd.set_option("display.width", 250)
pd.set_option("display.max_colwidth", 40)
print(res.to_string(index=False, float_format=lambda v: f"{v:.3g}"))
res.to_csv(OUT / "patterns_repetition.csv", index=False)

print("\n== repetition, maps with >= 3 repeat pairs")
for name, df in [("train", tr), ("test", te), ("algo", a)]:
    d = df[df["repetition.repeat_pairs"] >= 3]
    print(f"{name}: n={len(d)}, mappers={d.owner.nunique()}, rhythm repeat {qstr(d['repetition.repeat.rhythm'])}, baseline {qstr(d['repetition.baseline.rhythm'])}, gain {qstr(d['rep_rhythm_gain'])}, share gain>0.15: {(d.rep_rhythm_gain > 0.15).mean():.2f}")
    print(f"      lanes repeat {qstr(d['repetition.repeat.lanes'])}, lanes_or_mirror {qstr(d['repetition.repeat.lanes_or_mirror'])}, lanes gain {qstr(d['rep_lanes_gain'])}")

print("\n== per test song: rhythm repeat/baseline, humans vs generator")
m = te[["set_id", "genre", "repetition.repeat_pairs", "repetition.repeat.rhythm", "repetition.baseline.rhythm", "repetition.repeat.lanes"]].merge(
    a[["set_id", "repetition.repeat_pairs", "repetition.repeat.rhythm", "repetition.baseline.rhythm", "repetition.repeat.lanes"]], on="set_id", suffixes=("_h", "_a"))
print(m.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
