"""Gdzie ludzie zaczynają holdy na Hard (tabela slotów, sloty wybrane): regresja logistyczna hold_start | wybrany slot.
Wynik: tables/hold_placement.csv, tables/hold_placement_coefs.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from common import TABLES, algo, chosen_target, human, notes, slots

FE = ["rms", "kiai", "downbeat", "env_harm", "env_perc", "env_low", "env_high", "env_stem_vocals", "env_stem_bass", "env_stem_other",
      "env_stem_drums", "ev_lead", "ev_bass", "ev_kick", "ev_snare", "onset_stem_vocals", "onset_harm"]


def rows_for(who, sid, split, owner):
    z = slots(who if who == "algo" else "human", sid)
    ch, nn, _ = chosen_target(z, notes(who, sid), who == "algo")
    df = pd.DataFrame({k: z[k] for k in z if z[k].ndim == 1})[ch].copy()
    df["hold"] = z["chosen_hold_start"][ch].astype(bool)
    df["snap1"] = (df["snap"] == 1).astype(float)
    df["snap2"] = (df["snap"] == 2).astype(float)
    df["set_id"], df["split"], df["owner"], df["who"] = sid, split, owner, who
    return df


h = human()
a = algo()
D = pd.concat([rows_for("human", r.set_id, r.split, r.owner) for _, r in h.iterrows()] +
              [rows_for("algo", r.set_id, "algo", "algo") for _, r in a.iterrows()], ignore_index=True)
for c in ["kiai", "downbeat", "onset_stem_vocals", "onset_harm"]:
    D[c] = D[c].astype(float)
F = FE + ["snap1", "snap2"]
D[F] = D[F].fillna(0)
# only charts that use holds (>= 2% of moments start a hold)
use = D.groupby("set_id").hold.transform("mean") >= 0.02
tr = D[(D.split == "train") & use]
te = D[(D.split == "test") & use]
al = D[(D.who == "algo")]
sc = StandardScaler().fit(tr[F])
m = LogisticRegression(max_iter=2000).fit(sc.transform(tr[F]), tr.hold)
ma = LogisticRegression(max_iter=2000).fit(StandardScaler().fit(al[F]).transform(al[F]), al.hold)
out = pd.DataFrame({"feature": F, "coef_human_train": m.coef_[0], "coef_algo": ma.coef_[0]})
out.to_csv(f"{TABLES}/hold_placement_coefs.csv", index=False)
res = dict(train_charts=tr.set_id.nunique(), test_charts=te.set_id.nunique(),
           auc_train=roc_auc_score(tr.hold, m.predict_proba(sc.transform(tr[F]))[:, 1]),
           auc_test=roc_auc_score(te.hold, m.predict_proba(sc.transform(te[F]))[:, 1]),
           auc_algo_by_human_model=roc_auc_score(al.hold, m.predict_proba(sc.transform(al[F]))[:, 1]))
pd.DataFrame([res]).to_csv(f"{TABLES}/hold_placement.csv", index=False)
print(res)
print(out.assign(a=out.coef_human_train.abs()).sort_values("a", ascending=False).round(2).to_string(index=False))
for who, d in [("human_train", tr), ("algo", al)]:
    print(who, "hold start on beat %.2f, on 1/2 %.2f" % (d[d.hold].snap1.mean(), d[d.hold].snap2.mean()),
          "| hold rate when vocals onset %.3f vs not %.3f" % (d[d.onset_stem_vocals == 1].hold.mean(), d[d.onset_stem_vocals == 0].hold.mean()))
