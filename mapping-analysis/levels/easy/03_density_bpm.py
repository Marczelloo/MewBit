"""Density, rhythmic divisions and limits on Easy, and how they depend on BPM (RC scale around 180 BPM). Metrics v2:
beat / half-beat coverage is the official coverage.*.
Humans: train for the rules, test to check them. Writes out/bpm_bins.csv, out/limits.csv."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import spearmanr

from common import OUT, metrics, q

h = metrics("human")
a = metrics("algo")
GAPS = ["1", "1/2", "2", "3/2", "3/4", "8", "other", "2/3", "3", "4", "1/4", "6", "1/3"]
for df in (h, a):
    for g in GAPS:
        if f"gap_share.{g}" not in df.columns:
            df[f"gap_share.{g}"] = 0.0
    for c in [c for c in df.columns if c.startswith("gap_share.")]:
        df[c] = df[c].fillna(0.0)
    df["bpmm"] = df["song.main_bpm"]
    df["half_gap_ms"] = 30000 / df.bpmm
    df["sub_beat_gap_share"] = df[[c for c in ["gap_share.3/4", "gap_share.1/2", "gap_share.1/4", "gap_share.1/3", "gap_share.2/3"] if c in df.columns]].sum(axis=1)

# beat / half-beat coverage: the official metrics v2 (coverage.beat, coverage.half; one slot per moment)
for df in (h, a):
    df["half_mapped"] = df["coverage.half"]
    df["beat_mapped"] = df["coverage.beat"]

tr = h[h.split == "train"]
te = h[h.split == "test"]
cols = ["nps", "mps", "notes_per_beat", "moments_per_beat", "nps_window.p90", "nps_window.max", "beat_mapped", "half_mapped",
        "gap_share.1", "gap_share.1/2", "sub_beat_gap_share", "gap_share.2", "run_1/2.count_per_min", "run_1/2.max_notes", "run_1/1.max_notes",
        "gap_ms.min", "gap_ms.p5", "gap_beats.p5", "chord_share", "hold_share", "rests_ge_2b.per_min", "longest_rest_beats"]

print("== Spearman with main BPM (train n=%d / test n=%d)" % (len(tr), len(te)))
rows = []
for c in cols:
    r1, p1 = spearmanr(tr.bpmm, tr[c], nan_policy="omit")
    r2, p2 = spearmanr(te.bpmm, te[c], nan_policy="omit")
    rows.append({"metric": c, "rho_train": r1, "p_train": p1, "rho_test": r2, "p_test": p2})
sp = pd.DataFrame(rows)
print(sp.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
sp.to_csv(OUT / "bpm_spearman.csv", index=False, float_format="%.4g")

print("\n== log-log elasticity vs BPM (train): 0 = constant per second, 1 = constant per beat")
for c in ["nps", "mps", "notes_per_beat", "half_mapped", "beat_mapped"]:
    d = tr[[c, "bpmm"]].dropna()
    d = d[d[c] > 0]
    X = sm.add_constant(np.log(d.bpmm))
    m = sm.OLS(np.log(d[c]), X).fit()
    lo, hi = m.conf_int().iloc[1]
    print(f"  {c}: slope {m.params.iloc[1]:+.2f} [95% CI {lo:+.2f}, {hi:+.2f}], R2 {m.rsquared:.2f}")
d = tr.copy()
X = sm.add_constant(np.log(d.bpmm))
m = sm.OLS(np.log(d.nps), X).fit()
print("  nps predicted at 120/150/180/210/240 BPM:", [round(float(np.exp(m.params.iloc[0] + m.params.iloc[1] * np.log(b))), 2) for b in (120, 150, 180, 210, 240)])
m2 = sm.OLS(np.log(d.notes_per_beat), X).fit()
print("  notes/beat predicted at 120/150/180/210/240 BPM:", [round(float(np.exp(m2.params.iloc[0] + m2.params.iloc[1] * np.log(b))), 2) for b in (120, 150, 180, 210, 240)])

bins = [0, 150, 180, 210, 1000]
labels = ["<150", "150-180", "180-210", ">=210"]
h["bbin"] = pd.cut(h.bpmm, bins, right=False, labels=labels)
a["bbin"] = pd.cut(a.bpmm, bins, right=False, labels=labels)
print("\n== per BPM bin, humans train (test in brackets: p50)")
out = []
for b in labels:
    t = h[(h.split == "train") & (h.bbin == b)]
    s = h[(h.split == "test") & (h.bbin == b)]
    al = a[a.bbin == b]
    r = {"bin": b, "n_train": len(t), "mappers_train": t.owner.nunique(), "n_test": len(s), "n_algo": len(al)}
    for c in ["nps", "notes_per_beat", "beat_mapped", "half_mapped", "gap_share.1/2", "sub_beat_gap_share", "run_1/2.max_notes", "run_1/2.count_per_min", "gap_ms.min", "half_gap_ms", "hold_share", "chord_share"]:
        p10, p50, p90 = q(t[c])
        r[c] = f"{p10:.2f}/{p50:.2f}/{p90:.2f}"
        r[c + " test p50"] = f"{q(s[c])[1]:.2f}" if len(s) else "-"
        r[c + " algo p50"] = f"{q(al[c])[1]:.2f}" if len(al) else "-"
    out.append(r)
bb = pd.DataFrame(out)
bb.to_csv(OUT / "bpm_bins.csv", index=False)
pd.set_option("display.width", 300)
pd.set_option("display.max_columns", 60)
print(bb.T.to_string())

# limits / candidate hard rules
print("\n== candidate hard limits: share of maps satisfying (train | test | algo)")
lim = {
    "no 3+ note chords": lambda d: (d["chord_size_share.3"] + d["chord_size_share.4"]) == 0,
    "no runs of 1/4 (run_1/4.count==0)": lambda d: d["run_1/4.count_per_min"] == 0,
    "no gap < 1/2 beat (gap_beats.p5>=0.49 & no 1/4 gaps)": lambda d: d["fast_runs_1_4_or_finer.count_per_min"] == 0,
    "run_1/2.max_notes <= 5": lambda d: d["run_1/2.max_notes"] <= 5,
    "run_1/2.max_notes <= 9": lambda d: d["run_1/2.max_notes"] <= 9,
    "no triplets (triplet_share==0)": lambda d: d.triplet_share == 0,
    "triplet_share < 1%": lambda d: d.triplet_share < 0.01,
    "snap 1/4+1/8+1/16 < 2%": lambda d: (d["snap_share.4"] + d["snap_share.8"] + d["snap_share.16"]) < 0.02,
    "jack_max_notes <= 2": lambda d: d.jack_max_notes <= 2,
    "jack_max_notes <= 4": lambda d: d.jack_max_notes <= 4,
    "no fast minijack (<=1/4)": lambda d: d.minijack_fast_share == 0,
    "max_simultaneous_holds <= 1": lambda d: d.max_simultaneous_holds <= 1,
    "max_simultaneous_holds <= 2": lambda d: d.max_simultaneous_holds <= 2,
    "holds_with_notes_inside_share <= 0.2 (maps with holds)": lambda d: (d.holds_with_notes_inside_share.fillna(0) <= 0.2),
    "holds_context.release_at_next_moment_share >= 0.8 (maps with holds)": lambda d: d["holds_context.release_at_next_moment_share"].fillna(1) >= 0.8,
    "holds_context.start_on_beat_share >= 0.7 (maps with holds)": lambda d: d["holds_context.start_on_beat_share"].fillna(1) >= 0.7,
    "hold_short_share.lt_1 <= 0.05 (maps with holds)": lambda d: d["hold_short_share.lt_1"].fillna(0) <= 0.05,
    "chords_in_half_runs_per_min == 0": lambda d: d.chords_in_half_runs_per_min == 0,
    "kiai_start.note_share == 1 (maps with kiai)": lambda d: d["kiai_start.note_share"].fillna(1) >= 0.999,
    "kiai_start.chord_share >= 0.5 (maps with kiai)": lambda d: d["kiai_start.chord_share"].fillna(1) >= 0.5,
    "hand_balance_4bar.over_0_2_share == 0": lambda d: d["hand_balance_4bar.over_0_2_share"].fillna(0) == 0,
    "coverage.beat >= 0.6": lambda d: d["coverage.beat"] >= 0.6,
    "other_hand_notes_per_beat_in_hold.p90 == 0": lambda d: d["other_hand_notes_per_beat_in_hold.p90"].fillna(0) == 0,
    "release_snap_share.1 >= 0.7 (maps with holds)": lambda d: d["release_snap_share.1"].fillna(1) >= 0.7,
    "release_gap_beats.p5 >= 0.99": lambda d: d["release_gap_beats.p5"].fillna(9) >= 0.99,
    "hold_len_beats.p10 >= 0.99": lambda d: d["hold_len_beats.p10"].fillna(9) >= 0.99,
    "downbeats_carried >= 0.75": lambda d: d.downbeats_carried >= 0.75,
    "on_beat_share >= 0.6": lambda d: d.on_beat_share >= 0.6,
    "nps between 2.5 and 4.5": lambda d: d.nps.between(2.5, 4.5),
    "notes_per_beat >= 0.85": lambda d: d.notes_per_beat >= 0.85,
    "no_sound_share <= 0.05": lambda d: d["alignment.no_sound_share"] <= 0.05,
    "left_hand_share in [0.47,0.53]": lambda d: d.left_hand_share.between(0.47, 0.53),
    "chord_share <= 0.30": lambda d: d.chord_share <= 0.30,
    "boundary_note_share >= 0.7": lambda d: d["sections.boundary_note_share"] >= 0.7,
    "kiai_density_ratio >= 1 (maps with kiai)": lambda d: d.kiai_density_ratio.fillna(9) >= 1.0,
}
rows = []
for k, f in lim.items():
    r = {"rule": k}
    for name, df in [("train", h[h.split == "train"]), ("test", h[h.split == "test"]), ("algo", a)]:
        ok = f(df)
        r[name] = f"{ok.sum()}/{len(df)}"
        r[name + "_mappers_violating"] = df.loc[~ok, "owner"].nunique()
    rows.append(r)
lim_df = pd.DataFrame(rows)
print(lim_df.to_string(index=False))
lim_df.to_csv(OUT / "limits.csv", index=False)

print("\n== maps breaking the RC Easy rhythm guidelines (train+test humans)")
cols2 = ["set_id", "split", "genre", "bpmm", "owner", "stars", "run_1/4.count_per_min", "run_1/4.max_notes", "run_1/2.max_notes", "triplet_share", "snap_share.4", "gap_ms.min", "notes_per_beat"]
br = h[(h["run_1/4.count_per_min"] > 0) | (h["run_1/2.max_notes"] > 9) | (h.triplet_share > 0.01)]
print(br[cols2].sort_values("bpmm").to_string(index=False, float_format=lambda v: f"{v:.3g}"))
