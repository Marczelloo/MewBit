"""Co ludzie mapują na Normal: tabele slotów (siatka 1/8 i 1/6 mapy ludzkiej).

1. Udział zmapowanych slotów wg pozycji w siatce (ludzie trening/test, algorytm test).
2. „Recall” klas zdarzeń pluginu i onsetów stemów/detektorów: P(slot zmapowany | jest zdarzenie), wg pozycji.
3. Regresja logistyczna `mapped` (trening) -> AUC na teście ludzi; ten sam model na slotach algorytmu.
4. Co odróżnia zmapowane od pominiętych dźwięków na beacie / półbeacie.

Wynik: results/slots.md, results/slots_coefs.csv
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from common import RESULTS, algo, fmt, human, md_table, slots

H = human()
A = algo()
DET = ["full", "perc", "harm", "low", "lowmid", "highmid", "high", "stem_drums", "stem_bass", "stem_vocals", "stem_other"]
EV = ["kick", "snare", "hat", "perc", "bass", "lead", "low", "lowmid", "highmid", "high"]
POS = {1: "1/1", 2: "1/2", 4: "1/4", 8: "1/8", 3: "1/3", 6: "1/6"}


def frame(who, set_id, split, genre):
    s = slots(who, set_id)
    d = pd.DataFrame({k: v for k, v in s.items()})
    d["set_id"] = set_id
    d["who"] = who
    d["split"] = split
    d["genre"] = genre
    d["pos"] = d["snap"].map(POS)
    d["beat_int"] = np.floor(d["beat_in_bar"] + 1e-6).astype(int)
    # zmapowany slot na siatce 1/6 i jednocześnie 1/8 nie istnieje (każdy punkt raz); kontrola
    return d


frames = []
for r in H.itertuples():
    frames.append(frame("human", r.set_id, r.split, r.genre))
for r in A.itertuples():
    frames.append(frame("algo", r.set_id, "test", r.genre))
S = pd.concat(frames, ignore_index=True)
S["any_ev"] = (S[[f"ev_{e}" for e in EV]].max(axis=1) > 0)
S["drum_ev"] = (S[[f"ev_{e}" for e in ["kick", "snare", "hat", "perc"]]].max(axis=1) > 0)
S["n_onsets"] = S[[f"onset_{x}" for x in DET]].sum(axis=1)

groups = {"ludzie trening": (S.who == "human") & (S.split == "train"),
          "ludzie test": (S.who == "human") & (S.split == "test"),
          "algorytm test": (S.who == "algo")}
out = []

# --- 1. pozycja w siatce -------------------------------------------------------------------------------------------
rows = []
for pos in ["1/1", "1/2", "1/4", "1/8", "1/3", "1/6"]:
    cells = [pos]
    for g, m in groups.items():
        sub = S[m & (S.pos == pos)]
        per_song = sub.groupby("set_id").mapped.mean()
        cells.append(f"{sub.mapped.mean():.3f} (utwory p10/p50/p90 {fmt(per_song.quantile(.1))}/{fmt(per_song.quantile(.5))}/{fmt(per_song.quantile(.9))})")
    rows.append(cells)
for lab, cond in [("downbeat", S.downbeat), ("beat 1 lub 3 taktu (nie downbeat)", (S.pos == "1/1") & ~S.downbeat & S.beat_int.isin([2])),
                  ("beat 2 lub 4 taktu", (S.pos == "1/1") & S.beat_int.isin([1, 3]))]:
    cells = [lab]
    for g, m in groups.items():
        sub = S[m & cond]
        cells.append(f"{sub.mapped.mean():.3f}")
    rows.append(cells)
out.append("### 1. Udział zmapowanych slotów wg pozycji (pula slotów; w nawiasie rozrzut między utworami)\n\n" +
           md_table(rows, ["pozycja"] + list(groups)))

# --- 2. recall zdarzeń pluginu i onsetów -----------------------------------------------------------------------------
rows = []
for e in EV:
    col = f"ev_{e}"
    cells = [f"plugin `{e}`"]
    for g, m in groups.items():
        sub = S[m & (S[col] > 0)]
        on = sub[sub.pos.isin(["1/1", "1/2"])]
        off = sub[~sub.pos.isin(["1/1", "1/2"])]
        strong = sub[sub[col] >= 0.5]
        cells.append(f"{sub.mapped.mean():.2f} | 1/1+1/2: {on.mapped.mean():.2f} | reszta: {off.mapped.mean():.2f} | s≥0,5: {strong.mapped.mean():.2f}")
    rows.append(cells)
for x in DET:
    col = f"onset_{x}"
    cells = [f"onset `{x}`"]
    for g, m in groups.items():
        sub = S[m & S[col]]
        on = sub[sub.pos.isin(["1/1", "1/2"])]
        off = sub[~sub.pos.isin(["1/1", "1/2"])]
        cells.append(f"{sub.mapped.mean():.2f} | 1/1+1/2: {on.mapped.mean():.2f} | reszta: {off.mapped.mean():.2f}")
    rows.append(cells)
cells = ["slot bez żadnego onsetu i zdarzenia"]
for g, m in groups.items():
    sub = S[m & (S.n_onsets == 0) & ~S.any_ev]
    on = sub[sub.pos.isin(["1/1", "1/2"])]
    cells.append(f"{sub.mapped.mean():.2f} | 1/1+1/2: {on.mapped.mean():.2f}")
rows.append(cells)
out.append("### 2. P(slot zmapowany | zdarzenie / onset w slocie), wg pozycji\n\n" + md_table(rows, ["źródło"] + list(groups)))

# recall per utwór dla stemów (rozrzut)
rows = []
for x in ["stem_drums", "stem_bass", "stem_vocals", "stem_other", "perc", "harm"]:
    cells = [x]
    for g, m in groups.items():
        sub = S[m & S[f"onset_{x}"] & S.pos.isin(["1/1", "1/2"])]
        per = sub.groupby("set_id").mapped.mean()
        cells.append(f"{fmt(per.quantile(.1))} / {fmt(per.quantile(.5))} / {fmt(per.quantile(.9))}")
    rows.append(cells)
out.append("#### Recall onsetów na 1/1 i 1/2, rozrzut między utworami (p10/p50/p90)\n\n" + md_table(rows, ["onset"] + list(groups)))

# --- 3. regresja logistyczna ---------------------------------------------------------------------------------------
pos_d = pd.get_dummies(S.pos, prefix="pos").astype(float)
pos_d = pos_d.drop(columns=["pos_1/8"])  # poziom odniesienia: 1/8
feat = pd.concat([
    pos_d,
    S[["downbeat", "kiai"]].astype(float),
    pd.get_dummies(S.phrase4_bar, prefix="bar4").astype(float).drop(columns=["bar4_0"]),
    S[["rms"]],
    S[[f"env_{x}" for x in DET]].clip(0, 3),
    S[[f"onset_{x}" for x in DET]].astype(float),
    S[[f"ev_{e}" for e in EV]],
], axis=1).fillna(0)
tr = groups["ludzie trening"].values
te = groups["ludzie test"].values
al = groups["algorytm test"].values
y = S.mapped.astype(int).values
sets = {
    "tylko pozycja (+downbeat, kiai, takt w bloku 4)": [c for c in feat if c.startswith(("pos_", "bar4_")) or c in ("downbeat", "kiai")],
    "pozycja + onsety librosa (bez stemów)": [c for c in feat if c.startswith(("pos_", "bar4_")) or c in ("downbeat", "kiai")]
    + [f"onset_{x}" for x in DET[:7]] + [f"env_{x}" for x in DET[:7]] + ["rms"],
    "pozycja + zdarzenia pluginu": [c for c in feat if c.startswith(("pos_", "bar4_", "ev_")) or c in ("downbeat", "kiai", "rms")],
    "pełny (pozycja, onsety, stemy, plugin, RMS)": list(feat.columns),
}
rows = []
models = {}
for name, cols in sets.items():
    sc = StandardScaler().fit(feat.loc[tr, cols])
    lr = LogisticRegression(C=1.0, max_iter=2000).fit(sc.transform(feat.loc[tr, cols]), y[tr])
    p_te = lr.predict_proba(sc.transform(feat.loc[te, cols]))[:, 1]
    p_al = lr.predict_proba(sc.transform(feat.loc[al, cols]))[:, 1]
    # AUC w obrębie utworu (średnia) — bez wpływu różnej gęstości między utworami
    def per_song_auc(mask, p):
        sub = S.loc[mask, ["set_id", "mapped"]].copy()
        sub["p"] = p
        return np.nanmedian([roc_auc_score(g.mapped, g.p) for _, g in sub.groupby("set_id") if g.mapped.nunique() == 2])
    rows.append([name, len(cols), f"{roc_auc_score(y[tr], lr.predict_proba(sc.transform(feat.loc[tr, cols]))[:, 1]):.3f}",
                 f"{roc_auc_score(y[te], p_te):.3f}", f"{per_song_auc(te, p_te):.3f}",
                 f"{roc_auc_score(y[al], p_al):.3f}", f"{per_song_auc(al, p_al):.3f}"])
    models[name] = (lr, sc, cols)
out.append("### 3. Regresja logistyczna `mapped` (L2, C=1, cechy standaryzowane), uczona na 78 utworach treningowych\n\n"
           "AUC na slotach ludzi z testu mówi, jak dobrze model przewiduje ludzkie decyzje na nowych utworach; AUC na slotach algorytmu mówi, "
           "na ile algorytm wybiera to, co model ludzki uważa za warte nuty.\n\n" +
           md_table(rows, ["model", "cech", "AUC trening", "AUC ludzie test (pula)", "AUC ludzie test (mediana na utwór)",
                           "AUC algorytm test (pula)", "AUC algorytm (mediana na utwór)"]))

lr, sc, cols = models["pełny (pozycja, onsety, stemy, plugin, RMS)"]
coef = pd.DataFrame({"feature": cols, "coef_std": lr.coef_[0]}).sort_values("coef_std", ascending=False)
# ten sam model uczony na slotach algorytmu (test), żeby zobaczyć, czym algorytm się kieruje
sc2 = StandardScaler().fit(feat.loc[al, cols])
lr2 = LogisticRegression(C=1.0, max_iter=2000).fit(sc2.transform(feat.loc[al, cols]), y[al])
sc3 = StandardScaler().fit(feat.loc[te, cols])
lr3 = LogisticRegression(C=1.0, max_iter=2000).fit(sc3.transform(feat.loc[te, cols]), y[te])
coef["coef_std_human_test_refit"] = coef.feature.map(dict(zip(cols, lr3.coef_[0])))
coef["coef_std_algo_test_fit"] = coef.feature.map(dict(zip(cols, lr2.coef_[0])))
coef.to_csv(RESULTS / "slots_coefs.csv", index=False)
crow = [[r.feature, f"{r.coef_std:+.2f}", f"{r.coef_std_human_test_refit:+.2f}", f"{r.coef_std_algo_test_fit:+.2f}"] for r in coef.itertuples()]
out.append("#### Współczynniki pełnego modelu (standaryzowane; dodatni = sprzyja nucie). Kolumny 3–4: ten sam model dopasowany osobno "
           "do ludzi z testu i do algorytmu z testu (te same 20 utworów)\n\n" + md_table(crow, ["cecha", "ludzie trening", "ludzie test (refit)", "algorytm test (fit)"]))

# --- 4. pominięte dźwięki na 1/1 i 1/2 ------------------------------------------------------------------------------
rows = []
for g, m in groups.items():
    sub = S[m & S.pos.isin(["1/1", "1/2"]) & S.onset_perc]
    mp = sub[sub.mapped]
    sk = sub[~sub.mapped]
    rows.append([g, len(sub), f"{len(mp) / max(1, len(sub)):.2f}",
                 f"{mp.env_perc.median():.2f} vs {sk.env_perc.median():.2f}",
                 f"{mp.rms.median():.2f} vs {sk.rms.median():.2f}",
                 f"{(mp.pos == '1/1').mean():.2f} vs {(sk.pos == '1/1').mean():.2f}",
                 f"{mp.onset_stem_drums.mean():.2f} vs {sk.onset_stem_drums.mean():.2f}",
                 f"{mp.onset_stem_vocals.mean():.2f} vs {sk.onset_stem_vocals.mean():.2f}"])
out.append("### 4. Onsety perkusyjne na 1/1 i 1/2: zmapowane vs pominięte (mediany / udziały)\n\n" +
           md_table(rows, ["grupa", "slotów z onsetem perc", "udział zmapowanych", "env_perc", "RMS", "udział na beacie",
                           "z onsetem stemu perkusji", "z onsetem stemu wokalu"]))

# --- 5. nuty bez dźwięku: gdzie ludzie stawiają nutę bez onsetu -----------------------------------------------------
rows = []
for g, m in groups.items():
    sub = S[m & S.mapped]
    silent = sub[(sub.n_onsets == 0) & ~sub.any_ev]
    rows.append([g, len(sub), f"{len(silent) / len(sub):.3f}", f"{(silent.pos == '1/1').mean():.2f}", f"{(silent.pos == '1/2').mean():.2f}",
                 f"{silent.hold_start.mean():.2f}"])
out.append("### 5. Zmapowane sloty bez żadnego onsetu (librosa, stemy) ani zdarzenia pluginu\n\n" +
           md_table(rows, ["grupa", "zmapowanych slotów", "udział bez dźwięku", "z nich na 1/1", "z nich na 1/2", "z nich start holda"]))

# --- 6. gatunki: udział zmapowanych na pozycjach (ludzie trening) ---------------------------------------------------
rows = []
for gname in ["anime", "electronic", "video game", "pop"]:
    sub = S[groups["ludzie trening"] & (S.genre == gname)]
    cells = [gname, sub.set_id.nunique()]
    for pos in ["1/1", "1/2", "1/4", "1/3"]:
        cells.append(f"{sub[sub.pos == pos].mapped.mean():.3f}")
    for x in ["stem_drums", "stem_vocals", "stem_bass", "stem_other"]:
        s2 = sub[sub[f"onset_{x}"] & sub.pos.isin(["1/1", "1/2"])]
        cells.append(f"{s2.mapped.mean():.2f}")
    rows.append(cells)
out.append("### 6. Gatunki (ludzie trening): udział zmapowanych slotów wg pozycji i recall onsetów stemów na 1/1+1/2\n\n" +
           md_table(rows, ["gatunek", "utworów", "1/1", "1/2", "1/4", "1/3", "stem_drums", "stem_vocals", "stem_bass", "stem_other"]))

# --- 7. pozycja × obecność dźwięku × głośność ----------------------------------------------------------------------------
S["rms_t"] = S.groupby("set_id").rms.transform(lambda x: pd.qcut(x.rank(method="first"), 3, labels=["cichy", "średni", "głośny"]))
rows = []
for pos in ["1/1", "1/2", "1/4"]:
    for snd, cond in [("z onsetem perc", S.onset_perc), ("tylko inne onsety/zdarzenia", ~S.onset_perc & ((S.n_onsets > 0) | S.any_ev)),
                      ("bez dźwięku", (S.n_onsets == 0) & ~S.any_ev)]:
        cells = [pos, snd]
        for g, m in groups.items():
            sub = S[m & (S.pos == pos) & cond]
            cells.append(" / ".join(f"{sub[sub.rms_t == t].mapped.mean():.2f}" for t in ["cichy", "średni", "głośny"]) + f" (n={len(sub)})")
        rows.append(cells)
for pos in ["1/1", "1/2"]:
    for kv in [False, True]:
        cells = [pos, "kiai" if kv else "poza kiai"]
        for g, m in groups.items():
            sub = S[m & (S.pos == pos) & (S.kiai == kv)]
            cells.append(f"{sub.mapped.mean():.2f} (n={len(sub)})")
        rows.append(cells)
out.append("### 7. P(zmapowany) wg pozycji, dźwięku i tercyla RMS w utworze (cichy / średni / głośny), oraz kiai\n\n" +
           md_table(rows, ["pozycja", "dźwięk / kiai"] + list(groups)))

# --- 8. które klasy pluginu niosą półbeaty ----------------------------------------------------------------------------
rows = []
for e in EV:
    cells = [e]
    for g, m in groups.items():
        sub = S[m & (S.pos == "1/2") & (S[f"ev_{e}"] > 0)]
        cells.append(f"{sub.mapped.mean():.2f} (n={len(sub)})")
    rows.append(cells)
cells = ["1/2 bez zdarzenia pluginu"]
for g, m in groups.items():
    sub = S[m & (S.pos == "1/2") & ~S.any_ev]
    cells.append(f"{sub.mapped.mean():.2f} (n={len(sub)})")
rows.append(cells)
out.append("### 8. Półbeaty (1/2): P(zmapowany | zdarzenie pluginu danej klasy w slocie)\n\n" + md_table(rows, ["klasa"] + list(groups)))

(RESULTS / "slots.md").write_text("\n\n".join(out))
print("\n\n".join(out))
