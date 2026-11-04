"""Combination models, group CV by song, greedy subset, group ablation, cross-level transfer."""
import json, sys, time, pickle
import numpy as np
from common import *
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from joblib import Parallel, delayed

songs = load()
names = songs[0]["names"]
NF = len(names)
rng = np.random.default_rng(0)
NFOLD = 5
fold_of = {s["id"]: int(f) for s, f in zip(songs, rng.permutation(len(songs)) % NFOLD)}

def grp(n):
    if n.startswith("rc_") or n == "has_repeat": return "rc"
    if n.startswith("p_"): return "plugin"
    if n.startswith("flux_full") or n == "os_broad": return "fluxfull"
    if n.startswith("flux_H"): return "fluxH"
    if n.startswith("flux_P"): return "fluxP"
    if n.startswith("tv_") or n in ("hcqt_flux", "chroma_change"): return "tv_chroma"
    if n.startswith("dist_") or n.startswith("rel_"): return "dist"
    if n.startswith("m_") or n in ("d_beat", "d_grid"): return "meter"
    return "other"
G = {}
for j, n in enumerate(names): G.setdefault(grp(n), []).append(j)
print({k: len(v) for k, v in G.items()})

def data(lv, ss=None):
    ss = ss or songs_with(songs, lv)
    X = np.concatenate([s["Xr"] for s in ss]); y = np.concatenate([s["label"][lv] for s in ss])
    sid = np.concatenate([np.full(len(s["t"]), i) for i, s in enumerate(ss)])
    fold = np.array([fold_of[s["id"]] for s in ss])[sid]
    return ss, X, y, sid, fold

def mk(kind):
    if kind == "lr": return LogisticRegression(C=1.0, max_iter=300)
    return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=1.0, random_state=0)

def oof(X, y, fold, cols, kind="lr", ytrain=None):
    p = np.zeros(len(y))
    yt = y if ytrain is None else ytrain
    for f in range(NFOLD):
        tr = fold != f; te = ~tr
        m = mk(kind).fit(X[tr][:, cols], yt[tr])
        p[te] = m.predict_proba(X[te][:, cols])[:, 1]
    return p

def per_song_auc(p, ss, sid, ylab):
    return np.array([auc_fast(p[sid == i], ylab[sid == i]) for i in range(len(ss))])

def metrics(p, ss, sid, ylab, lv, f1=True):
    a = per_song_auc(p, ss, sid, ylab)
    out = dict(auc=float(np.nanmedian(a)))
    if f1:
        fs = [f1_topk(s["t"], p[sid == i], s["hidx"][lv], s["human"][lv], seed=i) for i, s in enumerate(ss)]
        out["f1"] = float(np.nanmedian(fs))
    return out

single = pickle.load(open("/scripts/single.pkl", "rb"))
allc = list(range(NF))
R = {}
t0 = time.time()
for lv in LV:
    ss, X, y, sid, fold = data(lv)
    r = {}
    bj = int(np.nanargmax(single["res"][lv]["auc"])); r["best_single"] = (names[bj], float(single["res"][lv]["auc"][bj]), float(single["res"][lv]["f1"][bj]))
    bf = int(np.nanargmax(single["res"][lv]["f1"])); r["best_single_f1"] = (names[bf], float(single["res"][lv]["f1"][bf]))
    p = oof(X, y, fold, allc, "lr"); r["lr_all"] = metrics(p, ss, sid, y, lv)
    p = oof(X, y, fold, allc, "hgb"); r["hgb_all"] = metrics(p, ss, sid, y, lv)
    nor = [j for j in allc if grp(names[j]) != "rc"]
    p = oof(X, y, fold, nor, "lr"); r["lr_no_rc"] = metrics(p, ss, sid, y, lv)
    p = oof(X, y, fold, nor, "hgb"); r["hgb_no_rc"] = metrics(p, ss, sid, y, lv)
    for g, cols in G.items():
        p = oof(X, y, fold, cols, "lr"); r[f"only_{g}"] = metrics(p, ss, sid, y, lv, f1=False)
        rest = [j for j in allc if j not in cols]
        p = oof(X, y, fold, rest, "lr"); r[f"drop_{g}"] = metrics(p, ss, sid, y, lv, f1=False)
    aud = [j for j in allc if grp(names[j]) not in ("plugin",)]
    p = oof(X, y, fold, aud, "lr"); r["lr_audio_only"] = metrics(p, ss, sid, y, lv)
    R[lv] = r
    print(lv, "done", round(time.time() - t0), flush=True)
    for k, v in r.items(): print("  ", k, v)

# greedy forward selection (LR), among all features; also among non-rc
def score_cols(X, y, fold, sid, ss, cols):
    p = oof(X, y, fold, cols, "lr")
    return float(np.nanmedian(per_song_auc(p, ss, sid, y)))

def greedy(lv, pool, steps=5):
    ss, X, y, sid, fold = data(lv)
    chosen = []; path = []
    for st in range(steps):
        cand = [j for j in pool if j not in chosen]
        sc = Parallel(n_jobs=16)(delayed(score_cols)(X, y, fold, sid, ss, chosen + [j]) for j in cand)
        b = int(np.argmax(sc)); chosen.append(cand[b]); path.append((names[cand[b]], sc[b]))
        print(lv, "step", st + 1, names[cand[b]], round(sc[b], 4), flush=True)
    return path
for lv in LV:
    pool_all = allc
    R[lv]["greedy_all"] = greedy(lv, pool_all)
    R[lv]["greedy_norc"] = greedy(lv, [j for j in allc if grp(names[j]) != "rc"], steps=4)

# cross level on songs with all three levels
both = [s for s in songs if all(lv in s["label"] for lv in LV)]
print("songs with all 3 levels", len(both))
ss, X0, _, sid, fold = data("easy", both)
Y = {lv: np.concatenate([s["label"][lv] for s in both]) for lv in LV}
cross = {}
for a in LV:
    for b in LV:
        p = oof(X0, Y[b], fold, allc, "lr", ytrain=Y[a])   # train on level a labels, test on level b
        au = per_song_auc(p, ss, sid, Y[b])
        cross[(a, b)] = float(np.nanmedian(au))
        print("train", a, "test", b, "AUC %.4f" % cross[(a, b)], flush=True)
R["cross"] = cross
# also a pure ranking-reuse test: model trained on a, tested on b, F1 at b's own k
cross_f1 = {}
for a in LV:
    for b in LV:
        p = oof(X0, Y[b], fold, allc, "lr", ytrain=Y[a])
        fs = [f1_topk(s["t"], p[sid == i], s["hidx"][b], s["human"][b], seed=i) for i, s in enumerate(both)]
        cross_f1[(a, b)] = float(np.nanmedian(fs))
        print("train", a, "test", b, "F1 %.4f" % cross_f1[(a, b)], flush=True)
R["cross_f1"] = cross_f1

# coefficients per level (LR on all songs, standardized by feature std)
coefs = {}
for lv in LV:
    ss, X, y, sid, fold = data(lv)
    sd = X.std(0) + 1e-9
    m = LogisticRegression(C=1.0, max_iter=500).fit((X - X.mean(0)) / sd, y)
    coefs[lv] = m.coef_[0]
R["coefs"] = {lv: dict(zip(names, map(float, c))) for lv, c in coefs.items()}
for a in LV:
    print("coef cosine", a, [round(float(coefs[a] @ coefs[b] / np.linalg.norm(coefs[a]) / np.linalg.norm(coefs[b])), 3) for b in LV])

# group permutation importance for HGB on normal, fold 0 held out
ss, X, y, sid, fold = data("normal")
m = mk("hgb").fit(X[fold != 0], y[fold != 0])
te = fold == 0; Xt = X[te]; yt = y[te]; sidt = sid[te]
base = np.nanmedian([auc_fast(m.predict_proba(Xt)[:, 1][sidt == i], yt[sidt == i]) for i in np.unique(sidt)])
imp = {}
prng = np.random.default_rng(1)
for g, cols in G.items():
    d = []
    for rep in range(3):
        Xp = Xt.copy()
        # permute within song to keep per-song distribution
        for i in np.unique(sidt):
            idx = np.where(sidt == i)[0]; perm = prng.permutation(idx)
            Xp[np.ix_(idx, cols)] = Xt[np.ix_(perm, cols)]
        pr = m.predict_proba(Xp)[:, 1]
        d.append(base - np.nanmedian([auc_fast(pr[sidt == i], yt[sidt == i]) for i in np.unique(sidt)]))
    imp[g] = float(np.mean(d))
R["hgb_perm_importance_normal"] = imp
print("hgb perm importance (AUC drop) normal", imp, "base", base)

pickle.dump(dict(R=R, names=names), open("/scripts/models.pkl", "wb"))
print("DONE", round(time.time() - t0))
