"""Profil ludzkiego Hard: kwantyle metryk (trening/test), zależność od BPM, gatunki.
Wynik: tables/profile_quantiles.csv, tables/bpm_spearman.csv, tables/genre_quantiles.csv, tables/genre_kruskal.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from scipy import stats

from common import BIG_GENRES, TABLES, human, q

h = human()
num = [c for c in h.columns if h[c].dtype.kind in "fi" and c not in ("set_id", "year", "beatmap_id", "hard_owners", "hard_beatmap_id")]

rows = []
for c in num:
    for split in ["train", "test"]:
        s = h.loc[h.split == split, [c, "owner"]].dropna()
        if len(s) == 0:
            continue
        qs = q(s[c], (0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95))
        rows.append(dict(metric=c, split=split, n=len(s), mappers=s.owner.nunique(), min=s[c].min(),
                         p5=qs[0], p10=qs[1], p25=qs[2], p50=qs[3], p75=qs[4], p90=qs[5], p95=qs[6], max=s[c].max(),
                         mean=s[c].mean()))
prof = pd.DataFrame(rows)
# test inside train p5..p95 / p10..p90
tr = prof[prof.split == "train"].set_index("metric")
inside = []
for c in num:
    if c not in tr.index:
        continue
    t = h.loc[h.split == "test", c].dropna()
    if len(t) == 0:
        continue
    lo5, hi95, lo10, hi90 = tr.loc[c, "p5"], tr.loc[c, "p95"], tr.loc[c, "p10"], tr.loc[c, "p90"]
    # Mann-Whitney train vs test
    trv = h.loc[h.split == "train", c].dropna()
    p = stats.mannwhitneyu(trv, t).pvalue if len(trv) > 3 and len(t) > 3 and trv.nunique() > 1 else np.nan
    inside.append(dict(metric=c, test_in_train_p5_p95=((t >= lo5) & (t <= hi95)).mean(),
                       test_in_train_p10_p90=((t >= lo10) & (t <= hi90)).mean(), mw_p_train_vs_test=p))
prof = prof.merge(pd.DataFrame(inside), on="metric", how="left")
prof.to_csv(f"{TABLES}/profile_quantiles.csv", index=False)

# BPM dependence (train): Spearman with bpm (main BPM of the corpus)
tr_h = h[h.split == "train"]
bp = []
for c in num:
    if c in ("bpm",):
        continue
    s = tr_h[[c, "bpm"]].dropna()
    if len(s) < 20 or s[c].nunique() < 3:
        continue
    r, p = stats.spearmanr(s["bpm"], s[c])
    te = h[h.split == "test"][[c, "bpm"]].dropna()
    rt, pt = (stats.spearmanr(te["bpm"], te[c]) if len(te) > 5 and te[c].nunique() > 2 else (np.nan, np.nan))
    bp.append(dict(metric=c, n=len(s), rho_train=r, p_train=p, rho_test=rt, p_test=pt))
pd.DataFrame(bp).sort_values("p_train").to_csv(f"{TABLES}/bpm_spearman.csv", index=False)

# Genre quantiles (train) and Kruskal-Wallis among the 4 big genres
g = []
kw = []
for c in num:
    groups = []
    for genre in BIG_GENRES + ["other"]:
        s = tr_h.loc[tr_h.genre4 == genre, [c, "owner"]].dropna()
        if len(s) == 0:
            continue
        qs = q(s[c])
        g.append(dict(metric=c, genre=genre, n=len(s), mappers=s.owner.nunique(), p10=qs[0], p50=qs[1], p90=qs[2]))
        if genre in BIG_GENRES:
            groups.append(s[c].values)
    if len(groups) == 4 and all(len(x) >= 5 for x in groups) and len(np.unique(np.concatenate(groups))) > 3:
        H, p = stats.kruskal(*groups)
        te = h[h.split == "test"]
        kw.append(dict(metric=c, H=H, p=p))
pd.DataFrame(g).to_csv(f"{TABLES}/genre_quantiles.csv", index=False)
pd.DataFrame(kw).sort_values("p").to_csv(f"{TABLES}/genre_kruskal.csv", index=False)
print("ok", len(prof), len(bp), len(kw))
