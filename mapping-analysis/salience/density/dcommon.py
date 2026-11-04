# Shared helpers for the density measurements. In mewbeat-ma: /repo = repo (ro), /scripts = salience dir with feat/,
# /out = .mewbeat-debug, /cache = scratch cache (phrases dumped by the Node recomposition of analyse()). Train songs only.
import os, sys, json
import numpy as np
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
from common import load, rank_cols, auc_fast, LV  # noqa: E402
from extract import meter, candidates, TEST  # noqa: E402

DATA = "/repo/.mewbeat-debug/data"
PH = "/cache/phrases"
NFOLD = 5
K_COLS = ["rel_os", "m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]


def songs_train():
    """The 80 train songs: pkl + Features v4 json + generator timing/phrases. Test ids are filtered before any read."""
    ss = load()
    ss = [s for s in ss if s["id"] not in TEST]
    for s in ss:
        s["f"] = json.load(open(f"{DATA}/features/{s['id']}.json"))
        s["ph"] = json.load(open(f"{PH}/{s['id']}.json"))
        ts, P, pn = candidates(s["f"])
        assert len(ts) == len(s["t"]) and np.allclose(ts, s["t"]), s["id"]
        s["P"] = P
    return ss


def folds(n):
    rng = np.random.default_rng(0)
    return rng.permutation(n) % NFOLD


def gen_meter(s):
    """Meter from the beat grid the generator really has (ctx.timing), not the raw tracker beats the pkl used."""
    tm = s["ph"]["timing"]
    return meter(s["t"], tm["beats"] if tm["snapped"] else [], tm["downbeats"] if tm["snapped"] else [], 0)


def lr_oof(X, y, fold):
    p = np.zeros(len(y))
    for f in range(NFOLD):
        tr, te = fold != f, fold == f
        if y[tr].sum() == 0:
            continue
        p[te] = LogisticRegression(C=1.0, max_iter=400).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return p


def per_song_auc(p, sid, y, n):
    return np.array([auc_fast(p[sid == i], y[sid == i]) for i in range(n)])
