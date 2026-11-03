"""Algorytm a ludzie na zbiorze testowym (Hard): p10/p50/p90, różnice parami, Wilcoxon, w podziale na gatunki.
Wynik: tables/compare_test.csv, tables/compare_test_genre.csv, tables/compare_pairs.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from scipy import stats

from common import BIG_GENRES, TABLES, algo, human, q

h = human()
a = algo()
ht = h[h.split == "test"].set_index("set_id")
htr = h[h.split == "train"]
a = a.set_index("set_id")
common_ids = sorted(set(ht.index) & set(a.index))
num = [c for c in a.columns if a[c].dtype.kind in "fi" and c in ht.columns and c not in ("year", "bpm", "stars", "hard_owners")]

rows, pairs = [], []
for c in num:
    hv = ht.loc[common_ids, c]
    av = a.loc[common_ids, c]
    ok = hv.notna() & av.notna()
    hq, aq = q(hv), q(av)
    trq = q(htr[c], (0.1, 0.9))
    d = (av - hv)[ok]
    p = stats.wilcoxon(d).pvalue if ok.sum() >= 6 and (d != 0).sum() >= 6 else np.nan
    out_lo = (av[av.notna()] < trq[0]).mean() if av.notna().any() else np.nan
    out_hi = (av[av.notna()] > trq[1]).mean() if av.notna().any() else np.nan
    rows.append(dict(metric=c, n_h=int(hv.notna().sum()), n_a=int(av.notna().sum()), h_p10=hq[0], h_p50=hq[1], h_p90=hq[2],
                     a_p10=aq[0], a_p50=aq[1], a_p90=aq[2], diff_p50=float(d.median()) if len(d) else np.nan,
                     algo_gt_human=float((d > 0).mean()) if len(d) else np.nan, wilcoxon_p=p,
                     train_p10=trq[0], train_p90=trq[1], algo_below_train_p10=out_lo, algo_above_train_p90=out_hi))
    for sid in common_ids:
        pairs.append(dict(set_id=sid, genre=ht.loc[sid, "genre"], metric=c, human=ht.loc[sid, c], algo=a.loc[sid, c]))
cmp_ = pd.DataFrame(rows)
cmp_.to_csv(f"{TABLES}/compare_test.csv", index=False)
pd.DataFrame(pairs).to_csv(f"{TABLES}/compare_pairs.csv", index=False)

g = []
for genre in BIG_GENRES + ["other"]:
    ids = [s for s in common_ids if ht.loc[s, "genre4"] == genre]
    for c in num:
        hq, aq = q(ht.loc[ids, c]), q(a.loc[ids, c])
        g.append(dict(genre=genre, n=len(ids), metric=c, h_p10=hq[0], h_p50=hq[1], h_p90=hq[2], a_p10=aq[0], a_p50=aq[1], a_p90=aq[2]))
pd.DataFrame(g).to_csv(f"{TABLES}/compare_test_genre.csv", index=False)
print(len(common_ids), len(num))
