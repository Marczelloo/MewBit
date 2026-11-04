"""Cheap (no-HPSS) subsets vs HPSS subsets, LR group-CV, same folds as b_models."""
import numpy as np
from common import *
from sklearn.linear_model import LogisticRegression
songs = load(); names = songs[0]["names"]
rng = np.random.default_rng(0)
fold_of = {s["id"]: int(f) for s, f in zip(songs, rng.permutation(len(songs)) % 5)}
SUBS = {
 "rel_os": ["rel_os"],
 "rel_os+meter(m_beat,m_half,m_quarter,d_grid)": ["rel_os","m_beat","m_half","m_quarter","d_grid"],
 "noHPSS: rel_os+meter+flux_full_low": ["rel_os","m_beat","m_half","m_quarter","d_grid","flux_full_low"],
 "noHPSS: rel_os+meter+flux_full_low+dist_low": ["rel_os","m_beat","m_half","m_quarter","d_grid","flux_full_low","dist_low"],
 "noHPSS: rel_os+meter+flux_full_all+flux_full_low": ["rel_os","m_beat","m_half","m_quarter","d_grid","flux_full_all","flux_full_low"],
 "HPSS: rel_os+meter+flux_P_low": ["rel_os","m_beat","m_half","m_quarter","d_grid","flux_P_low"],
 "HPSS: rel_os+meter+flux_P_low+dist_Pall": ["rel_os","m_beat","m_half","m_quarter","d_grid","flux_P_low","dist_Pall"],
}
for lv in LV:
    ss = songs_with(songs, lv)
    X = np.concatenate([s["Xr"] for s in ss]); y = np.concatenate([s["label"][lv] for s in ss])
    sid = np.concatenate([np.full(len(s["t"]), i) for i, s in enumerate(ss)])
    fold = np.array([fold_of[s["id"]] for s in ss])[sid]
    for nm, cols in SUBS.items():
        j = [names.index(c) for c in cols]
        p = np.zeros(len(y))
        for f in range(5):
            m = LogisticRegression(C=1.0, max_iter=300).fit(X[fold != f][:, j], y[fold != f])
            p[fold == f] = m.predict_proba(X[fold == f][:, j])[:, 1]
        au = np.nanmedian([auc_fast(p[sid == i], y[sid == i]) for i in range(len(ss))])
        fs = np.nanmedian([f1_topk(s["t"], p[sid == i], s["hidx"][lv], s["human"][lv], seed=i) for i, s in enumerate(ss)])
        print("%-6s %-52s AUC %.4f F1 %.4f" % (lv, nm, au, fs), flush=True)
