"""Zależność gęstości i podziałów od BPM (Hard, ludzie trening/test i algorytm), skala RC wokół 180 BPM.
Wynik: tables/bpm_bins.csv, tables/bpm_regression.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from common import TABLES, algo, human

h = human()
a = algo()
a["split"] = "algo"
h["who"] = "human"
a["who"] = "algo"
for d in (h, a):
    d["bin"] = pd.cut(d["bpm"], [0, 150, 180, 210, 999], right=False, labels=["<150", "150-180", "180-210", ">=210"])
    d["q_or_finer"] = d["gap_share.1/4"] + d["gap_share.1/6"] + d["gap_share.1/8"] + d["gap_share.1/3"]
    d["ms_per_note"] = 1000.0 / d["nps"]
    d["fast_gap_ms_1_4"] = 60000.0 / d["bpm"] / 4
METRICS = ["nps", "notes_per_beat", "moments_per_beat", "chord_share", "gap_share.1", "gap_share.1/2", "gap_share.1/4", "q_or_finer",
           "snap_share.4", "run_1/2.max_notes", "run_1/4.max_notes", "run_1/4.count_per_min", "gap_ms.p5", "gap_ms.min",
           "gap_beats.p5", "fast_gap_ms_1_4", "nps_peak8s", "hold_share", "hold_len_beats.p50", "chord_size_share.3",
           "chords_in_fast_stream_per_min", "rests_ge_2b.per_min", "stars"]
rows = []
for who, d in [("human_train", h[h.split == "train"]), ("human_test", h[h.split == "test"]), ("algo_test", a)]:
    for b, g in d.groupby("bin", observed=True):
        for m in METRICS:
            s = g[m].dropna()
            rows.append(dict(who=who, bin=b, n=len(g), mappers=g["owner"].nunique() if "owner" in g else np.nan, metric=m,
                             p10=s.quantile(0.1), p50=s.median(), p90=s.quantile(0.9)))
out = pd.DataFrame(rows)
out.to_csv(f"{TABLES}/bpm_bins.csv", index=False)
pd.set_option("display.width", 250)
print(out[out.who != "algo_test"].pivot_table(index=["metric"], columns=["who", "bin"], values="p50", observed=True).round(3).to_string())
print(out[out.who == "human_train"].groupby("bin", observed=True).n.first(), out[out.who == "human_test"].groupby("bin", observed=True).n.first())

# log-linear regressions on train, check slope sign on test
reg = []
for m in ["nps", "notes_per_beat", "gap_share.1/4", "q_or_finer", "gap_share.1", "gap_ms.p5", "chord_share", "chord_size_share.3", "hold_share"]:
    for split in ["train", "test"]:
        d = h[h.split == split][[m, "bpm", "genre4"]].dropna().rename(columns={m: "y"})
        f = smf.ols("y ~ np.log2(bpm/180)", d).fit()
        f2 = smf.ols("y ~ np.log2(bpm/180) + C(genre4)", d).fit() if split == "train" else None
        reg.append(dict(metric=m, split=split, n=len(d), at180=f.params.iloc[0], slope_per_doubling=f.params.iloc[1], p=f.pvalues.iloc[1], r2=f.rsquared,
                        slope_genre_adj=f2.params["np.log2(bpm / 180)"] if f2 is not None else np.nan,
                        p_genre_adj=f2.pvalues["np.log2(bpm / 180)"] if f2 is not None else np.nan))
pd.DataFrame(reg).to_csv(f"{TABLES}/bpm_regression.csv", index=False)
print(pd.DataFrame(reg).round(3).to_string())
