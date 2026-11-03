"""Kontrola odporności na drganie siatki algorytmu (Hard, zbiór testowy).
Nuty algorytmu leżą średnio 4 ms (p90 8 ms) od siatki ludzkiej, więc metryki liczone na dokładnych podziałach (klasy odstępów
z tolerancją ±6%, serie 1/2 i 1/4, rytm powtórzeń na slotach 1/24 beatu) karzą go także za samo drganie.
Tu każda chwila (ludzka i algorytmu) jest przypisana do najbliższego slotu tabeli slotów (algorytm: najpierw siatka 1/8),
a odstępy i serie liczone są na indeksach slotów. To analiza pomocnicza, nie nowa metryka (zob. REPORT.md, sekcja 8).
Powtórzenia: okna po 4 takty; podobieństwo muzyczne przybliżone obwiedniami onsetów i RMS z tabeli slotów (bez chromy),
para 'powtórzenie' = górne 5% par w utworze (min. podobieństwo 0,5), 'baza' = dolna połowa par.
Wynik: tables/robust_rhythm.csv, tables/robust_repetition.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, human, notes, slots

GAP_CLASSES = {"1": 1.0, "1/2": 0.5, "1/4": 0.25, "3/4": 0.75, "3/2": 1.5, "2": 2.0, "1/3": 1 / 3, "1/6": 1 / 6, "1/8": 0.125, "2/3": 2 / 3}


def beat_positions(z):
    t = z["t"]
    beats = t[z["snap"] == 1]
    idx = np.arange(len(beats), dtype=float)
    return np.interp(t, beats, idx, left=np.nan, right=np.nan)


def quantized_moments(who, sid, z, pos):
    nts = notes(who, sid)
    binary = np.isin(z["snap"], [1, 2, 4, 8])
    moms = {}
    for n in nts:
        moms.setdefault(n[0], []).append(n[1])
    out = []
    for t0, lanes in sorted(moms.items()):
        d = np.abs(z["t"] - t0)
        if who == "algo":
            db = np.where(binary, d, np.inf)
            i = int(np.argmin(db))
            if db[i] > 25:
                i = int(np.argmin(d))
        else:
            i = int(np.argmin(d))
        if d[i] <= 25 and np.isfinite(pos[i]):
            out.append((i, pos[i], tuple(sorted(set(lanes))), t0))
    # two moments on one slot: keep the first
    seen, uniq = set(), []
    for m in out:
        if m[0] in seen:
            continue
        seen.add(m[0])
        uniq.append(m)
    return uniq


def gap_class(g):
    for name, v in GAP_CLASSES.items():
        if abs(g - v) <= 0.06 * v:
            return name
    return "other"


def runs(classes, cls):
    out, cur = [], 0
    for c in classes:
        if c == cls:
            cur += 1
        else:
            if cur:
                out.append(cur + 1)
            cur = 0
    if cur:
        out.append(cur + 1)
    return out


def rhythm_stats(moms, minutes):
    p = np.array([m[1] for m in moms])
    g = np.diff(p)
    cls = [gap_class(x) for x in g]
    r = dict(n=len(moms))
    for c in ["1", "1/2", "1/4", "3/4", "other"]:
        r[f"gap_{c}"] = np.mean([x == c for x in cls]) if cls else np.nan
    for c in ["1/2", "1/4"]:
        rr = runs(cls, c)
        r[f"run_{c}_max"] = max(rr) if rr else 0
        r[f"run_{c}_p90"] = float(np.quantile(rr, 0.9)) if rr else 0
        r[f"run_{c}_per_min"] = len(rr) / minutes
    # runs of "1/2 or finer" (a stream of the 1/2 grid with 1/4 inside counts as one)
    dense = ["d" if c in ("1/2", "1/4") else c for c in cls]
    rr = runs(dense, "d")
    r["run_le_1/2_max"] = max(rr) if rr else 0
    r["run_le_1/2_p50"] = float(np.median(rr)) if rr else 0
    r["run_le_1/2_per_min"] = len(rr) / minutes
    return r


def windows_of(z, pos):
    downs = np.where(z["downbeat"])[0]
    w = []
    for k in range(0, len(downs) - 4, 4):
        a, b = downs[k], downs[k + 4]
        w.append((a, b))
    return w


ENV = ["env_perc", "env_harm", "env_low", "env_lowmid", "env_highmid", "env_high", "rms"]


def window_vectors(z, wins):
    binary = np.isin(z["snap"], [1, 2, 4, 8])
    X = np.vstack([z[e] for e in ENV]).T
    X = (X - X.mean(0)) / (X.std(0) + 1e-9)
    vecs = []
    for a, b in wins:
        sel = np.arange(a, b)[binary[a:b]]
        vecs.append(X[sel].ravel())
    L = min(len(v) for v in vecs)
    V = np.vstack([v[:L] for v in vecs])
    V = V - V.mean(1, keepdims=True)
    V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
    return V @ V.T, L


def identity(moms, win, wins_slots):
    a, b = win
    return {m[0] - a: m[2] for m in moms if a <= m[0] < b}


def pair_identity(sa, sb):
    if not sa and not sb:
        return None
    shared = set(sa) & set(sb)
    rhythm = len(shared) / len(set(sa) | set(sb))
    lanes = np.mean([sa[k] == sb[k] for k in shared]) if shared else 0.0
    mir = np.mean([sa[k] == tuple(sorted(3 - l for l in sb[k])) for k in shared]) if shared else 0.0
    return rhythm, lanes, max(lanes, mir)


h = human().set_index("set_id")
a = algo().set_index("set_id")
rows, reps = [], []
for sid in h.index:
    zh = slots("human", sid)
    pos = beat_positions(zh)
    for who in (["human", "algo"] if sid in a.index else ["human"]):
        moms = quantized_moments(who, sid, zh, pos)
        if who == "algo":
            # the algo chart's own span may exceed the human slot table: only the overlap counts
            pass
        minutes = (zh["t"][-1] - zh["t"][0]) / 60000.0
        r = rhythm_stats(moms, minutes)
        r.update(set_id=sid, who=who, genre=h.loc[sid, "genre4"], split=h.loc[sid, "split"] if who == "human" else "algo")
        rows.append(r)
    # repetition on 4-bar windows
    wins = windows_of(zh, pos)
    if len(wins) < 6:
        continue
    S, L = window_vectors(zh, wins)
    iu = np.triu_indices(len(wins), 1)
    vals = S[iu]
    thr_rep = max(0.5, np.quantile(vals, 0.95))
    thr_base = np.quantile(vals, 0.5)
    rep_pairs = [(i, j) for i, j, v in zip(*iu, vals) if v >= thr_rep]
    base_pairs = [(i, j) for i, j, v in zip(*iu, vals) if v <= thr_base][:400]
    for who in (["human", "algo"] if sid in a.index else ["human"]):
        moms = quantized_moments(who, sid, zh, pos)
        slot_sets = [identity(moms, w, None) for w in wins]
        for kind, pairs in [("powtórzenie", rep_pairs), ("baza", base_pairs)]:
            vals_ = [pair_identity(slot_sets[i], slot_sets[j]) for i, j in pairs]
            vals_ = [v for v in vals_ if v is not None]
            if vals_:
                arr = np.array(vals_)
                reps.append(dict(set_id=sid, who=who, kind=kind, pairs=len(vals_), rhythm=arr[:, 0].mean(), lanes=arr[:, 1].mean(),
                                 lanes_or_mirror=arr[:, 2].mean(), thr=thr_rep, genre=h.loc[sid, "genre4"],
                                 split=h.loc[sid, "split"] if who == "human" else "algo"))
# histogram of quantized gaps (beats) for the 'other' class
hist = []
for sid in a.index:
    zh = slots("human", sid)
    pos = beat_positions(zh)
    for who in ["human", "algo"]:
        p = np.array([m[1] for m in quantized_moments(who, sid, zh, pos)])
        for g in np.diff(p):
            if gap_class(g) == "other":
                hist.append(dict(who=who, set_id=sid, gap=round(g * 8) / 8))
Hh = pd.DataFrame(hist)
print(Hh.groupby("who").gap.value_counts(normalize=True).groupby(level=0).head(8).round(3))
R = pd.DataFrame(rows)
R.to_csv(f"{TABLES}/robust_rhythm.csv", index=False)
P = pd.DataFrame(reps)
P.to_csv(f"{TABLES}/robust_repetition.csv", index=False)
pd.set_option("display.width", 250)
print(R.groupby(["who", "split"]).quantile([0.1, 0.5, 0.9], numeric_only=True).drop(columns=["set_id"]).round(3).T)
print(P.groupby(["split", "kind"])[["rhythm", "lanes", "lanes_or_mirror", "pairs"]].quantile([0.1, 0.5, 0.9]).round(3))
rp = P[P.kind == "powtórzenie"].set_index(["set_id", "who", "split"])
bp = P[P.kind == "baza"].set_index(["set_id", "who", "split"])
piv = pd.DataFrame({"rhythm_rep": rp.rhythm, "rhythm_base": bp.rhythm, "lanes_rep": rp.lanes_or_mirror, "lanes_base": bp.lanes_or_mirror}).dropna()
piv["rhythm_diff"] = piv.rhythm_rep - piv.rhythm_base
piv["lanes_diff"] = piv.lanes_rep - piv.lanes_base
piv = piv.reset_index()
print(piv.groupby("split")[["rhythm_diff", "lanes_diff"]].quantile([0.1, 0.5, 0.9]).round(3))
w = piv[piv.set_id.isin(a.index)].pivot_table(index="set_id", columns="who", values="rhythm_diff")
print("songs where algo rhythm_diff < human:", (w.algo < w.human).sum(), "of", len(w))
piv.to_csv(f"{TABLES}/robust_repetition_diff.csv", index=False)
