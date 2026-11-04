# Shared helpers for the density measurements. In mewbeat-ma: /repo = repo (ro), /scripts = salience dir with feat/,
# /out = .mewbeat-debug, /cache = scratch cache (phrases dumped by the Node recomposition of analyse()). Train songs only.
import os, sys, json, glob
import numpy as np
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
from common import load, rank_cols, auc_fast, LV, FEAT  # noqa: E402
from extract import meter, candidates, TEST  # noqa: E402

DATA = "/repo/.mewbeat-debug/data"
# PH: generator phrases + timing per train song, one <id>.json each, made on the host by dump_phrases.js (this directory):
#   node dump_phrases.js <train ids, comma-separated> <host cache dir>/phrases   (the cache dir is mounted as /cache in mewbeat-ma;
#   the script refuses test ids and takes the charts and features dirs as optional 3rd/4th arguments)
PH = "/cache/phrases"
NFOLD = 5
K_COLS = ["rel_os", "m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]


def songs_train():
    """The 80 train songs: pkl + Features v4 json + generator timing/phrases. The ids are taken from the file names and the test ids
    are removed before load() opens any pkl, so a test pkl is never read (none exists in /scripts/feat anyway)."""
    ids = {os.path.basename(p)[:-4] for p in glob.glob(f"{FEAT}/*.pkl")} - TEST - {"hd"}
    ss = load(ids)
    assert len(ss) == len(ids) and not ({s["id"] for s in ss} & TEST)
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


# ---- post-hoc proxies of rel_os built from Features v4 (fix round 3; chosen after seeing the mechanism result) ----------------------------
# rel_os takes a maximum over 5 frames of 256 samples at 22050 Hz, i.e. +-2 frames = +-2 * 11.61 ms = +-23.22 ms. The same half-width here.
MF_HALF_MS = 2 * 1000.0 * 256 / 22050
MF_REL_HALF_MS = 1000.0  # rel_os divides by a uniform mean over 172 frames = 2 s, i.e. +-1 s


def _bounds(ts, w):
    return np.searchsorted(ts, ts - w, "left"), np.searchsorted(ts, ts + w, "right")


def _wmax(v, ts, w):
    lo, hi = _bounds(ts, w)
    return np.array([v[a:b].max() for a, b in zip(lo, hi)])


def _wmean(v, ts, w):
    lo, hi = _bounds(ts, w)
    cs = np.concatenate([[0.0], np.cumsum(v, dtype=np.float64)])
    return (cs[hi] - cs[lo]) / (hi - lo)


def mf_proxies(s):
    """W_mf: max of raw_strength (largest source strength of the cluster) over all candidates within +-23.22 ms (the candidate itself included).
    W_mf_rel: W_mf / (mean of W_mf over the candidates within +-1 s + 1e-9). W_rel_mf: the order of rel_os (divide first, then max filter):
    max over +-23.22 ms of raw_strength / (mean of raw_strength over the candidates within +-1 s + 1e-9). The means are over candidates, not time."""
    ts, ps = s["t"], s["P"].max(1)
    wmf = _wmax(ps, ts, MF_HALF_MS)
    return {"W_mf": wmf, "W_mf_rel": wmf / (_wmean(wmf, ts, MF_REL_HALF_MS) + 1e-9),
            "W_rel_mf": _wmax(ps / (_wmean(ps, ts, MF_REL_HALF_MS) + 1e-9), ts, MF_HALF_MS)}
