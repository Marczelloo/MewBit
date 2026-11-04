import os, glob, pickle
import numpy as np
from scipy.stats import rankdata

FEAT = "/scripts/feat"
LV = ("easy", "normal", "hard")
WIN = 8000


def rank_cols(X):
    """per-song rank percentile for non-binary columns, raw for binary ones."""
    Xr = np.empty_like(X, dtype=np.float32)
    n = len(X)
    for j in range(X.shape[1]):
        c = X[:, j]
        u = np.unique(c)
        if len(u) <= 2:
            Xr[:, j] = c
        else:
            Xr[:, j] = (rankdata(c, method="average") / n)
    return Xr


def nearest_human(t, hm):
    if len(hm) == 0:
        return np.full(len(t), -1)
    j = np.clip(np.searchsorted(hm, t), 1, max(len(hm) - 1, 1))
    if len(hm) == 1:
        d = np.abs(t - hm[0]); return np.where(d <= 35, 0, -1)
    a = np.abs(t - hm[j - 1]); b = np.abs(t - hm[j])
    idx = np.where(a <= b, j - 1, j)
    d = np.minimum(a, b)
    return np.where(d <= 35, idx, -1)


def load(ids=None):
    songs = []
    for p in sorted(glob.glob(f"{FEAT}/*.pkl")):
        sid = os.path.basename(p)[:-4]
        if sid == "hd":
            continue
        if ids and sid not in ids:
            continue
        r = pickle.load(open(p, "rb"))
        r["id"] = sid
        r["Xr"] = rank_cols(r["X"])
        r["hidx"] = {lv: nearest_human(r["t"], r["human"][lv]) for lv in r["human"]}
        songs.append(r)
    return songs


def auc_fast(score, y):
    y = np.asarray(y); npos = int(y.sum()); nneg = len(y) - npos
    if npos < 5 or nneg < 5:
        return np.nan
    r = rankdata(score, method="average")
    return (r[y == 1].sum() - npos * (npos + 1) / 2) / (npos * nneg)


def f1_topk(t, score, hidx, hm, seed=0):
    """top-k per 8 s window, k = human moments in the window. F1 over distinct human moments."""
    nh = len(hm)
    if nh == 0:
        return np.nan
    rng = np.random.default_rng(seed)
    s = score + 1e-7 * rng.random(len(score))
    win = (t // WIN).astype(int)
    nwin = max(win.max(), int(hm.max() // WIN)) + 1
    k = np.bincount((hm // WIN).astype(int), minlength=nwin)
    order = np.lexsort((-s, win))
    ws = win[order]
    first = np.searchsorted(ws, ws, side="left")
    rk = np.arange(len(order)) - first
    sel = order[rk < k[ws]]
    h = hidx[sel]
    tp = len(np.unique(h[h >= 0]))
    return 2 * tp / (len(sel) + nh)


def songs_with(songs, lv):
    return [s for s in songs if lv in s["label"]]
