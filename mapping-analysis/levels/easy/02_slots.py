"""What humans map on Easy: slot tables (every 1/8 and 1/6 slot of the active span).
- mapped rate per grid position, per map (quantiles across maps);
- recall per plugin event class and per stem / detector onset, on beats and on half beats;
- logistic regression of `mapped` (beat slots, half-beat slots) trained on the train maps, AUC on the test maps;
- the same rates for the generator's charts on the test songs.
Writes out/slots_*.csv and prints a summary."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from common import OUT, metrics, q, slots

DET = ["full", "perc", "harm", "low", "lowmid", "highmid", "high", "stem_drums", "stem_bass", "stem_vocals", "stem_other"]
EV = ["kick", "snare", "hat", "perc", "bass", "lead", "low", "lowmid", "highmid", "high"]


def load(who, meta):
    frames = []
    for _, r in meta.iterrows():
        z = slots(who, r.set_id)
        df = pd.DataFrame({k: v for k, v in z.items()})
        df["set_id"] = r.set_id
        df["split"] = r.split
        df["genre_g"] = r.genre_g
        df["owner"] = r.owner
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df["bib"] = np.floor(np.round(df.beat_in_bar * 12) / 12).astype(int)
    df["any_onset"] = df[[f"onset_{d}" for d in DET if not d.startswith("stem")]].any(axis=1)
    df["any_ev"] = (df[[f"ev_{e}" for e in EV]] > 0).any(axis=1)
    return df


def per_map_rate(df, mask, col="mapped"):
    g = df[mask].groupby("set_id")[col].mean()
    return g


H = metrics("human")
A = metrics("algo")
hs = load("human", H)
als = load("algo", A)
print("human slots", len(hs), "algo slots", len(als))

out = []
# 1. mapped rate per grid position
print("\n== mapped rate per snap class (per map p10/p50/p90), human train | human test | algo test")
for snap in [1, 2, 4, 8, 3, 6]:
    r = {"what": f"snap_{snap}"}
    for name, df in [("tr", hs[hs.split == "train"]), ("te", hs[hs.split == "test"]), ("al", als)]:
        g = per_map_rate(df, df.snap == snap)
        r[name] = q(g)
    out.append(r)
    print(snap, *[np.round(r[k], 3) for k in ("tr", "te", "al")])
# downbeat vs other beats; beat 3 (bib==2)
for lab, f in [("downbeat", lambda d: (d.snap == 1) & d.downbeat), ("beat_not_downbeat", lambda d: (d.snap == 1) & ~d.downbeat),
               ("beat3", lambda d: (d.snap == 1) & (d.bib == 2)), ("beat2_4", lambda d: (d.snap == 1) & d.bib.isin([1, 3]))]:
    r = {"what": lab}
    for name, df in [("tr", hs[hs.split == "train"]), ("te", hs[hs.split == "test"]), ("al", als)]:
        r[name] = q(per_map_rate(df, f(df)))
    out.append(r)
    print(lab, *[np.round(r[k], 3) for k in ("tr", "te", "al")])

# 2. recall per event class and per onset detector, by position
print("\n== recall (share of slots with the event that are mapped), per map p10/p50/p90; beats | half beats")
rec = []
for pos, pm in [("beat", 1), ("half", 2), ("quarter", 4)]:
    for col in [f"ev_{e}" for e in EV] + [f"onset_{d}" for d in DET] + ["any_onset", "any_ev"]:
        r = {"pos": pos, "feature": col}
        for name, df in [("tr", hs[hs.split == "train"]), ("te", hs[hs.split == "test"]), ("al", als)]:
            m = (df.snap == pm) & ((df[col] > 0) if col.startswith("ev_") else df[col].astype(bool))
            m0 = (df.snap == pm) & ~((df[col] > 0) if col.startswith("ev_") else df[col].astype(bool))
            g1 = per_map_rate(df, m)
            g0 = per_map_rate(df, m0)
            # only maps with at least 10 such slots
            cnt = df[m].groupby("set_id").size()
            g1 = g1[cnt[cnt >= 10].index.intersection(g1.index)]
            r[f"{name}_with"] = q(g1)[1]
            r[f"{name}_without"] = q(g0)[1]
            r[f"{name}_n"] = len(g1)
            r[f"{name}_with_p10"], _, r[f"{name}_with_p90"] = q(g1)
            r[f"{name}_share_slots"] = float(m.sum() / max(1, (df.snap == pm).sum()))
        rec.append(r)
rec = pd.DataFrame(rec)
rec.to_csv(OUT / "slots_recall.csv", index=False, float_format="%.4g")
pd.set_option("display.width", 250)
pd.set_option("display.max_rows", 200)
print(rec[["pos", "feature", "tr_share_slots", "tr_with_p10", "tr_with", "tr_with_p90", "tr_without", "tr_n", "te_with", "te_without", "al_with", "al_without"]].to_string(index=False, float_format=lambda v: f"{v:.3f}"))

# 3. logistic regression on beat and half-beat slots
def design(df):
    X = pd.DataFrame(index=df.index)
    X["downbeat"] = df.downbeat.astype(float)
    X["beat3"] = (df.bib == 2).astype(float)
    X["phrase_first_bar"] = (df.phrase4_bar == 0).astype(float)
    X["kiai"] = df.kiai.astype(float)
    X["rms"] = df.rms
    X["bpm_rel"] = df.bpm / 180.0
    for d in DET:
        X[f"onset_{d}"] = df[f"onset_{d}"].astype(float)
        X[f"env_{d}"] = df[f"env_{d}"].clip(0, 3)
    for e in EV:
        X[f"ev_{e}"] = df[f"ev_{e}"]
    return X


coef_rows = []
for pos, pm in [("beat", 1), ("half", 2)]:
    tr = hs[(hs.split == "train") & (hs.snap == pm)]
    te = hs[(hs.split == "test") & (hs.snap == pm)]
    al = als[als.snap == pm]
    Xtr, Xte, Xal = design(tr), design(te), design(al)
    sc = StandardScaler().fit(Xtr)
    m = LogisticRegression(C=1.0, max_iter=2000).fit(sc.transform(Xtr), tr.mapped)
    auc_tr = roc_auc_score(tr.mapped, m.predict_proba(sc.transform(Xtr))[:, 1])
    auc_te = roc_auc_score(te.mapped, m.predict_proba(sc.transform(Xte))[:, 1])
    # how well does the human model "explain" the generator's choices on the same slots
    auc_al = roc_auc_score(al.mapped, m.predict_proba(sc.transform(Xal))[:, 1]) if al.mapped.nunique() > 1 else np.nan
    print(f"\n== logistic regression, {pos} slots: n_train={len(tr)} base rate={tr.mapped.mean():.3f}; AUC train {auc_tr:.3f}, test {auc_te:.3f}; same model on generator charts AUC {auc_al:.3f}")
    # group ablation
    groups = {
        "position (downbeat, beat3, phrase bar)": ["downbeat", "beat3", "phrase_first_bar"],
        "kiai+rms+bpm": ["kiai", "rms", "bpm_rel"],
        "librosa onsets/envelopes": [c for c in Xtr.columns if (c.startswith("onset_") or c.startswith("env_")) and "stem" not in c],
        "stems": [c for c in Xtr.columns if "stem" in c],
        "plugin events": [c for c in Xtr.columns if c.startswith("ev_")],
    }
    for gname, cols in groups.items():
        keep = [c for c in Xtr.columns if c not in cols]
        sc2 = StandardScaler().fit(Xtr[keep])
        m2 = LogisticRegression(C=1.0, max_iter=2000).fit(sc2.transform(Xtr[keep]), tr.mapped)
        a2 = roc_auc_score(te.mapped, m2.predict_proba(sc2.transform(Xte[keep]))[:, 1])
        only = LogisticRegression(C=1.0, max_iter=2000).fit(StandardScaler().fit_transform(Xtr[cols]), tr.mapped)
        a3 = roc_auc_score(te.mapped, only.predict_proba(StandardScaler().fit(Xtr[cols]).transform(Xte[cols]))[:, 1])
        print(f"   without {gname}: test AUC {a2:.3f} (drop {auc_te - a2:+.3f}); this group alone: {a3:.3f}")
        coef_rows.append({"pos": pos, "group": gname, "auc_without": a2, "auc_alone": a3, "auc_full": auc_te})
    co = pd.Series(m.coef_[0], index=Xtr.columns).sort_values()
    print("   standardized coefficients (most negative / most positive):")
    print("   ", ", ".join(f"{k} {v:+.2f}" for k, v in co.head(6).items()))
    print("   ", ", ".join(f"{k} {v:+.2f}" for k, v in co.tail(10).items()))
    for k, v in co.items():
        coef_rows.append({"pos": pos, "group": "coef", "feature": k, "coef": v})
pd.DataFrame(coef_rows).to_csv(OUT / "slots_logit.csv", index=False, float_format="%.4g")
pd.DataFrame([{**{"what": r["what"]}, **{f"{k}_{i}": v for k in ("tr", "te", "al") for i, v in zip(("p10", "p50", "p90"), r[k])}} for r in out]).to_csv(OUT / "slots_position.csv", index=False, float_format="%.4g")

# 4. what the plugin offers under the notes: share of mapped beat / half-beat slots with a drum event (kick, snare,
# perc, hat), with a tonal event (bass, lead conf >= 0.45), with band onsets only, or with nothing; and the strength
print("\n== under the mapped slots: share with a plugin drum event / tonal event / band onset only / nothing (per map p50)")
def cover(df, pm):
    d = df[(df.snap == pm) & df.mapped]
    drum = (d[["ev_kick", "ev_snare", "ev_perc", "ev_hat"]] > 0).any(axis=1)
    tonal = (d[["ev_bass", "ev_lead"]] > 0).any(axis=1)
    band = (d[["ev_low", "ev_lowmid", "ev_highmid", "ev_high"]] > 0).any(axis=1)
    g = pd.DataFrame({"set_id": d.set_id, "drum": drum, "tonal": tonal, "drum_or_tonal": drum | tonal, "band_only": band & ~drum & ~tonal,
                      "nothing": ~band & ~drum & ~tonal, "drum_s": d[["ev_kick", "ev_snare", "ev_perc"]].max(axis=1)}).groupby("set_id").mean()
    return g
for name, df in [("human train", hs[hs.split == "train"]), ("human test", hs[hs.split == "test"]), ("generator", als)]:
    for pos, pm in [("beat", 1), ("half", 2)]:
        g = cover(df, pm)
        print(f"  {name:12s} {pos:5s}: " + ", ".join(f"{c} {g[c].median():.2f}" for c in g.columns))

# 5. does the strength of the plugin drum hit decide which beats are mapped (the generator's Easy rule: a beat hit at or
# above the phrase median), or the loudness of the passage? Per map: mapped rate of beats with a drum event above vs
# below the map's median hit strength, and of beats in the loudest vs quietest third of the song (rms)
print("\n== beats: mapped rate by drum-hit strength (above/below the map median) and by passage loudness (rms terciles), per map p50 [p10-p90]")
def strength_vs_loudness(df):
    out = []
    for sid, d in df[df.snap == 1].groupby("set_id"):
        s = d[["ev_kick", "ev_snare", "ev_perc"]].max(axis=1)
        hit = s > 0
        med = s[hit].median()
        r1, r2 = d.mapped[hit & (s >= med)].mean(), d.mapped[hit & (s < med)].mean()
        t1, t2 = d.rms.quantile([1 / 3, 2 / 3])
        out.append({"strong_hit": r1, "weak_hit": r2, "loud": d.mapped[d.rms >= t2].mean(), "quiet": d.mapped[d.rms < t1].mean()})
    return pd.DataFrame(out)
for name, df in [("human train", hs[hs.split == "train"]), ("human test", hs[hs.split == "test"]), ("generator", als)]:
    g = strength_vs_loudness(df)
    print(f"  {name:12s}: " + ", ".join(f"{c} {g[c].median():.2f} [{g[c].quantile(.1):.2f}-{g[c].quantile(.9):.2f}]" for c in g.columns)
          + f"; maps strong>weak {(g.strong_hit > g.weak_hit).sum()}/{len(g)}, loud>quiet {(g.loud > g.quiet).sum()}/{len(g)}")

# 6. sensitivity: the 5 sets flagged in shared/alignment.md (all in train) left out
from common import FLAGGED
print("\n== sensitivity: models refit without the 5 flagged sets")
for pos, pm in [("beat", 1), ("half", 2)]:
    tr = hs[(hs.split == "train") & (hs.snap == pm) & ~hs.set_id.isin(FLAGGED)]
    te = hs[(hs.split == "test") & (hs.snap == pm)]
    Xtr, Xte = design(tr), design(te)
    sc = StandardScaler().fit(Xtr)
    m = LogisticRegression(C=1.0, max_iter=2000).fit(sc.transform(Xtr), tr.mapped)
    co = pd.Series(m.coef_[0], index=Xtr.columns).sort_values()
    print(f"  {pos}: test AUC {roc_auc_score(te.mapped, m.predict_proba(sc.transform(Xte))[:, 1]):.3f}; top +: " + ", ".join(f"{k} {v:+.2f}" for k, v in co.tail(5).items()))
