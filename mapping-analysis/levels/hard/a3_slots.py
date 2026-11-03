"""Co ludzie mapują na Hard: tabele slotów.
Cel 'chosen' = slot najbliższy chwili (każda chwila trafia do dokładnie jednego slotu, ±25 ms), bo kolumna `mapped`
oznacza każdy slot w ±25 ms od chwili i przy wysokim BPM jedna chwila zapala 2-3 sloty (1/8 i 1/6 leżą 11-14 ms od siebie).
Algorytm nie ma trioli, więc jego chwila trafia do najbliższego slotu binarnego (1/8), a dopiero bez niego do 1/6.
Wynik: tables/slot_rates.csv, tables/slot_logit_coefs.csv, tables/slot_logit_auc.csv, tables/slot_group_importance.csv,
       tables/slot_recall_by_source.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from common import TABLES, algo, human, notes, slots

DET = ["full", "perc", "harm", "low", "lowmid", "highmid", "high", "stem_drums", "stem_bass", "stem_vocals", "stem_other"]
EV = ["kick", "snare", "hat", "perc", "bass", "lead", "low", "lowmid", "highmid", "high"]
TOL = 25.0


def chosen_target(z, nts, binary_first):
    t = z["t"]
    mts = np.array(sorted(set(n[0] for n in nts)), dtype=float)
    chosen = np.zeros(len(t), bool)
    nnotes = np.zeros(len(t), int)
    cnt = {}
    for n in nts:
        cnt[n[0]] = cnt.get(n[0], 0) + 1
    binary = np.isin(z["snap"], [1, 2, 4, 8])
    unassigned = 0
    for m in mts:
        d = np.abs(t - m)
        if binary_first:
            db = np.where(binary, d, np.inf)
            i = int(np.argmin(db))
            if db[i] > TOL:
                i = int(np.argmin(d))
        else:
            i = int(np.argmin(d))
        if d[i] <= TOL:
            chosen[i] = True
            nnotes[i] = max(nnotes[i], cnt[m])
        else:
            unassigned += 1
    return chosen, nnotes, unassigned


def frame(who, sid, meta):
    z = slots(who, sid)
    nts = notes(who, sid)
    chosen, nn, un = chosen_target(z, nts, binary_first=(who == "algo"))
    df = pd.DataFrame({k: z[k] for k in z if z[k].ndim == 1})
    df["chosen"] = chosen
    df["chord"] = nn >= 2
    df["set_id"] = sid
    df["who"] = who
    for k, v in meta.items():
        df[k] = v
    return df, un


h = human()
a = algo()
frames, unassigned = [], []
for _, r in h.iterrows():
    df, un = frame("human", r.set_id, dict(split=r.split, genre=r.genre4, owner=r.owner))
    frames.append(df)
    unassigned.append(("human", r.set_id, un))
for _, r in a.iterrows():
    df, un = frame("algo", r.set_id, dict(split="test", genre=r.genre4, owner="algo"))
    frames.append(df)
    unassigned.append(("algo", r.set_id, un))
S = pd.concat(frames, ignore_index=True)
pd.DataFrame(unassigned, columns=["who", "set_id", "moments_without_slot"]).to_csv(f"{TABLES}/slot_unassigned.csv", index=False)

# --- features --------------------------------------------------------------------------------------------------
S["lbpm"] = np.log2(S["bpm"] / 180.0)
for s in [1, 2, 3, 4, 6, 8]:
    S[f"snap_{s}"] = (S["snap"] == s).astype(float)
S["snap_3or6"] = S["snap_3"] + S["snap_6"]
S["downbeat"] = S["downbeat"].astype(float)
S["kiai"] = S["kiai"].astype(float)
S["beat3"] = ((S["snap"] == 1) & (np.round(S["beat_in_bar"]) == 2)).astype(float)  # third beat (0-based 2)
S["backbeat"] = ((S["snap"] == 1) & np.isin(np.round(S["beat_in_bar"]), [1, 3])).astype(float)
S["last_bar_of_4"] = (S["phrase4_bar"] == 3).astype(float)
for s in [2, 4, 8]:
    S[f"snap_{s}_x_lbpm"] = S[f"snap_{s}"] * S["lbpm"]
S["any_onset"] = S[[f"onset_{d}" for d in DET[:7]]].any(axis=1).astype(float)
for d in DET:
    S[f"onset_{d}"] = S[f"onset_{d}"].astype(float)
for e in EV:
    S[f"has_{e}"] = (S[f"ev_{e}"] > 0).astype(float)

GROUPS = {
    "siatka": ["snap_2", "snap_4", "snap_8", "snap_3or6", "downbeat", "beat3", "backbeat", "last_bar_of_4",
               "snap_2_x_lbpm", "snap_4_x_lbpm", "snap_8_x_lbpm", "lbpm"],
    "energia_kiai": ["rms", "kiai"],
    "onsety_librosa": [f"onset_{d}" for d in DET[:7]] + [f"env_{d}" for d in DET[:7]],
    "zdarzenia_pluginu": [f"ev_{e}" for e in EV],
    "stemy": [f"onset_{d}" for d in DET[7:]] + [f"env_{d}" for d in DET[7:]],
}
FEATS = [f for g in GROUPS.values() for f in g]
S[FEATS] = S[FEATS].fillna(0.0)
S.to_parquet(os.path.join(TABLES, "_slots_all.parquet")) if False else None

# --- descriptive rates -----------------------------------------------------------------------------------------
def rate_rows(df, label):
    out = []
    for s in [1, 2, 4, 8, 3, 6]:
        m = df["snap"] == s
        per_song = df[m].groupby("set_id")["chosen"].mean()
        out.append(dict(group=label, cond=f"snap 1/{s}", slots=int(m.sum()), rate=df.loc[m, "chosen"].mean(),
                        song_p10=per_song.quantile(0.1), song_p50=per_song.median(), song_p90=per_song.quantile(0.9),
                        chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    m = df["downbeat"] == 1
    per_song = df[m].groupby("set_id")["chosen"].mean()
    out.append(dict(group=label, cond="downbeat", slots=int(m.sum()), rate=df.loc[m, "chosen"].mean(), song_p10=per_song.quantile(0.1),
                    song_p50=per_song.median(), song_p90=per_song.quantile(0.9), chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    for d in DET:
        for s in [None, 4]:
            m = df[f"onset_{d}"] == 1
            if s:
                m = m & (df["snap"] == s)
            per_song = df[m].groupby("set_id")["chosen"].mean()
            out.append(dict(group=label, cond=f"onset_{d}" + (f" & 1/{s}" if s else ""), slots=int(m.sum()),
                            rate=df.loc[m, "chosen"].mean(), song_p10=per_song.quantile(0.1), song_p50=per_song.median(),
                            song_p90=per_song.quantile(0.9), chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    m = df["any_onset"] == 0
    per_song = df[m].groupby("set_id")["chosen"].mean()
    out.append(dict(group=label, cond="no librosa onset", slots=int(m.sum()), rate=df.loc[m, "chosen"].mean(),
                    song_p10=per_song.quantile(0.1), song_p50=per_song.median(), song_p90=per_song.quantile(0.9),
                    chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    for e in EV:
        for strong in [False, True]:
            m = (df[f"ev_{e}"] >= 0.5) if strong else (df[f"ev_{e}"] > 0)
            per_song = df[m].groupby("set_id")["chosen"].mean()
            out.append(dict(group=label, cond=f"ev_{e}" + (" s>=0.5" if strong else ""), slots=int(m.sum()),
                            rate=df.loc[m, "chosen"].mean(), song_p10=per_song.quantile(0.1), song_p50=per_song.median(),
                            song_p90=per_song.quantile(0.9), chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    for k in [0, 1]:
        m = df["kiai"] == k
        out.append(dict(group=label, cond=f"kiai={k}", slots=int(m.sum()), rate=df.loc[m, "chosen"].mean(),
                        chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    for lo, hi in [(0, 0.3), (0.3, 0.6), (0.6, 0.9), (0.9, 9)]:
        m = (df["rms"] >= lo) & (df["rms"] < hi)
        out.append(dict(group=label, cond=f"rms {lo}-{hi}", slots=int(m.sum()), rate=df.loc[m, "chosen"].mean(),
                        chord_rate=df.loc[m & df.chosen, "chord"].mean()))
    return out


hum = S[S.who == "human"]
alg = S[S.who == "algo"]
test_ids = set(alg.set_id)
rows = rate_rows(hum[hum.split == "train"], "human_train") + rate_rows(hum[hum.split == "test"], "human_test") + rate_rows(alg, "algo_test")
# BPM bins for the grid rates (human train)
for lo, hi in [(0, 150), (150, 180), (180, 210), (210, 999)]:
    sub = hum[(hum.split == "train") & (hum.bpm >= lo) & (hum.bpm < hi)]
    for s in [1, 2, 4, 8]:
        m = sub["snap"] == s
        per_song = sub[m].groupby("set_id")["chosen"].mean()
        rows.append(dict(group=f"human_train_bpm{lo}-{hi}", cond=f"snap 1/{s}", slots=int(m.sum()), rate=sub.loc[m, "chosen"].mean(),
                         song_p10=per_song.quantile(0.1), song_p50=per_song.median(), song_p90=per_song.quantile(0.9),
                         chord_rate=sub.loc[m & sub.chosen, "chord"].mean(), songs=sub.set_id.nunique()))
pd.DataFrame(rows).to_csv(f"{TABLES}/slot_rates.csv", index=False)

# --- logistic regression -----------------------------------------------------------------------------------------
def fit(df, feats):
    sc = StandardScaler().fit(df[feats])
    m = LogisticRegression(C=1.0, max_iter=2000).fit(sc.transform(df[feats]), df["chosen"])
    return sc, m


def auc(sc, m, df, feats):
    return roc_auc_score(df["chosen"], m.predict_proba(sc.transform(df[feats]))[:, 1])


tr = hum[hum.split == "train"]
te = hum[hum.split == "test"]
sc, m = fit(tr, FEATS)
coefs = pd.DataFrame({"feature": FEATS, "coef_std_human_train": m.coef_[0]})
sca, ma = fit(alg, FEATS)
coefs["coef_std_algo_test"] = ma.coef_[0]
sct, mt = fit(te, FEATS)
coefs["coef_std_human_test"] = mt.coef_[0]
coefs["group"] = [g for g, fs in GROUPS.items() for _ in fs]
coefs.to_csv(f"{TABLES}/slot_logit_coefs.csv", index=False)

aucs = [dict(model="human_train", data="human_train", auc=auc(sc, m, tr, FEATS)),
        dict(model="human_train", data="human_test", auc=auc(sc, m, te, FEATS)),
        dict(model="human_train", data="algo_test", auc=auc(sc, m, alg, FEATS)),
        dict(model="algo_test", data="algo_test", auc=auc(sca, ma, alg, FEATS)),
        dict(model="algo_test", data="human_test", auc=auc(sca, ma, te, FEATS))]
# per-song AUC spread on human test
per = []
for sid, g in te.groupby("set_id"):
    if g.chosen.nunique() == 2:
        per.append(auc(sc, m, g, FEATS))
aucs.append(dict(model="human_train", data="human_test per song p10/p50/p90",
                 auc=float(np.median(per)), p10=float(np.quantile(per, 0.1)), p90=float(np.quantile(per, 0.9))))
pd.DataFrame(aucs).to_csv(f"{TABLES}/slot_logit_auc.csv", index=False)

# group importance: AUC on human test, model with one group only and without it
imp = []
for g, fs in GROUPS.items():
    only = fs
    without = [f for f in FEATS if f not in fs]
    s1, m1 = fit(tr, only)
    s2, m2 = fit(tr, without)
    imp.append(dict(group=g, auc_only=auc(s1, m1, te, only), auc_without=auc(s2, m2, te, without), auc_full=auc(sc, m, te, FEATS)))
pd.DataFrame(imp).to_csv(f"{TABLES}/slot_group_importance.csv", index=False)

# recall of sources on the same test songs: share of slots with that source that the chart chooses
rec = []
for who, df in [("human_test", te), ("algo_test", alg)]:
    for d in DET:
        mm = df[f"onset_{d}"] == 1
        rec.append(dict(who=who, source=f"onset_{d}", slots=int(mm.sum()), recall=df.loc[mm, "chosen"].mean(),
                        precision=df.loc[df.chosen, f"onset_{d}"].mean()))
    for e in EV:
        mm = df[f"ev_{e}"] > 0
        rec.append(dict(who=who, source=f"ev_{e}", slots=int(mm.sum()), recall=df.loc[mm, "chosen"].mean(),
                        precision=df.loc[df.chosen, f"has_{e}"].mean()))
pd.DataFrame(rec).to_csv(f"{TABLES}/slot_recall_by_source.csv", index=False)
print(pd.DataFrame(aucs))
print(pd.DataFrame(imp))

# --- decision models inside the musically relevant grid -------------------------------------------------------------
dec_rows = []
coef_rows = []
SUBSETS = {
    "1/1+1/2+1/4": lambda d: d["snap"].isin([1, 2, 4]),
    "tylko 1/4": lambda d: d["snap"] == 4,
    "tylko 1/2": lambda d: d["snap"] == 2,
}
for name, sel in SUBSETS.items():
    feats = [f for f in FEATS if not (name != "1/1+1/2+1/4" and f.startswith("snap_"))]
    trs, tes, als = tr[sel(tr)], te[sel(te)], alg[sel(alg)]
    s0, m0 = fit(trs, feats)
    dec_rows.append(dict(subset=name, target="chosen", group="(pełny)", auc_test=auc(s0, m0, tes, feats), auc_algo=auc(s0, m0, als, feats),
                         base_rate_train=trs.chosen.mean(), base_rate_test=tes.chosen.mean(), base_rate_algo=als.chosen.mean()))
    for g, fs in GROUPS.items():
        fs2 = [f for f in fs if f in feats]
        if not fs2:
            continue
        s1, m1 = fit(trs, fs2)
        rest = [f for f in feats if f not in fs2]
        s2, m2 = fit(trs, rest)
        dec_rows.append(dict(subset=name, target="chosen", group=g, auc_only=auc(s1, m1, tes, fs2), auc_without=auc(s2, m2, tes, rest)))
    sa, ma2 = fit(als, feats)
    for f, c1, c2 in zip(feats, m0.coef_[0], ma2.coef_[0]):
        coef_rows.append(dict(subset=name, target="chosen", feature=f, coef_human_train=c1, coef_algo_test=c2))

# chord or single, among chosen 1/1 and 1/2 slots
for name, sel in {"chord | wybrany beat": lambda d: d.chosen & (d["snap"] == 1), "chord | wybrany 1/2": lambda d: d.chosen & (d["snap"] == 2)}.items():
    feats = [f for f in FEATS if not f.startswith("snap_") and not f.endswith("_x_lbpm")]
    trs, tes, als = tr[sel(tr)].copy(), te[sel(te)].copy(), alg[sel(alg)].copy()
    for d in (trs, tes, als):
        d["chosen"] = d["chord"]
    s0, m0 = fit(trs, feats)
    dec_rows.append(dict(subset=name, target="chord", group="(pełny)", auc_test=auc(s0, m0, tes, feats), auc_algo=auc(s0, m0, als, feats),
                         base_rate_train=trs.chosen.mean(), base_rate_test=tes.chosen.mean(), base_rate_algo=als.chosen.mean()))
    for g, fs in GROUPS.items():
        fs2 = [f for f in fs if f in feats]
        s1, m1 = fit(trs, fs2)
        rest = [f for f in feats if f not in fs2]
        s2, m2 = fit(trs, rest)
        dec_rows.append(dict(subset=name, target="chord", group=g, auc_only=auc(s1, m1, tes, fs2), auc_without=auc(s2, m2, tes, rest)))
    sa, ma2 = fit(als, feats)
    for f, c1, c2 in zip(feats, m0.coef_[0], ma2.coef_[0]):
        coef_rows.append(dict(subset=name, target="chord", feature=f, coef_human_train=c1, coef_algo_test=c2))
pd.DataFrame(dec_rows).to_csv(f"{TABLES}/slot_decision_models.csv", index=False)
pd.DataFrame(coef_rows).to_csv(f"{TABLES}/slot_decision_coefs.csv", index=False)

# per-song rates (human all, algo) for genre / BPM analyses elsewhere
per_song = []
for (who, sid), g in S.groupby(["who", "set_id"]):
    row = dict(who=who, set_id=sid, split=g.split.iloc[0], genre=g.genre.iloc[0], bpm=float(np.median(g.bpm)))
    for s in [1, 2, 4, 8]:
        m = g["snap"] == s
        row[f"rate_1/{s}"] = g.loc[m, "chosen"].mean()
        row[f"chord_rate_1/{s}"] = g.loc[m & g.chosen, "chord"].mean()
    m = (g["snap"] == 4) & (g["onset_perc"] == 1)
    row["rate_1/4_with_perc_onset"] = g.loc[m, "chosen"].mean()
    m = (g["snap"] == 4) & (g["onset_perc"] == 0)
    row["rate_1/4_without_perc_onset"] = g.loc[m, "chosen"].mean()
    row["rate_downbeat"] = g.loc[g.downbeat == 1, "chosen"].mean()
    row["chord_rate_downbeat"] = g.loc[(g.downbeat == 1) & g.chosen, "chord"].mean()
    per_song.append(row)
pd.DataFrame(per_song).to_csv(f"{TABLES}/slot_rates_per_song.csv", index=False)
print(pd.DataFrame(dec_rows).round(3).to_string())
