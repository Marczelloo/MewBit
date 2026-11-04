# Do the separated instruments predict the human moments better than the plain ranking K? Group CV by song.
# In mewbeat-ma: /scripts = the salience dir with feat/, /out = .mewbeat-debug. Train songs only; the 20 test songs are never read.
#
# The bar, fixed before the first result:
#   1. K+stems beats K on Normal by at least .02 F1, with the 95% bootstrap interval above zero.
#   2. K+stems also beats everything the mix alone offers (ALL, without separation) on Normal, interval above zero;
#      otherwise a cheap analysis would give the same thing.
#   3. Neither Easy nor Hard gets worse: the mean F1 change stays above -.005.
import os, sys, glob, json, pickle
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

sys.path.insert(0, "/scripts")
from common import load, rank_cols, auc_fast, f1_topk, songs_with, LV, WIN

FEAT = "/out/data/stems/_feat"
OUTFILE = "/out/data/stems/_measure.json"
K_COLS = ["rel_os", "m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]
STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
NFOLD = 5


def mk(kind):
    if kind == "lr":
        return LogisticRegression(C=1.0, max_iter=400)
    return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=1.0, random_state=0)


def oof(X, y, fold, cols, kind):
    p = np.zeros(len(y))
    for f in range(NFOLD):
        tr, te = fold != f, fold == f
        p[te] = mk(kind).fit(X[tr][:, cols], y[tr]).predict_proba(X[te][:, cols])[:, 1]
    return p


def per_song(p, ss, sid, y, lv):
    auc = np.array([auc_fast(p[sid == i], y[sid == i]) for i in range(len(ss))])
    f1 = np.array([f1_topk(s["t"], p[sid == i], s["hidx"][lv], s["human"][lv], seed=i) for i, s in enumerate(ss)])
    return auc, f1


def boot(d, seed=7, n=4000):
    d = d[~np.isnan(d)]
    rng = np.random.default_rng(seed)
    m = d[rng.integers(0, len(d), (n, len(d)))].mean(1)
    return float(d.mean()), float(np.quantile(m, .025)), float(np.quantile(m, .975))


def window_diagnostics(ss, sid, p_k, lv):
    """Upper bound: in each 8 s window, what if we knew which single instrument the human followed?"""
    rng = np.random.default_rng(11)
    tot = dict(k=0, K=0, best=0, floor=0, loudest=0)
    per = {s: 0 for s in STEMS}
    for i, s in enumerate(ss):
        hm, hidx, t = s["human"][lv], s["hidx"][lv], s["t"]
        win = (t // WIN).astype(int)
        need = np.bincount((hm // WIN).astype(int), minlength=win.max() + 1)
        pk = p_k[sid == i]
        for w in np.unique(win):
            k = int(need[w]) if w < len(need) else 0
            at = np.where(win == w)[0]
            if k == 0 or len(at) == 0:
                continue
            def tp(score):
                h = hidx[at[np.argsort(-score[at])[:k]]]
                return len(np.unique(h[h >= 0]))
            by = {st: tp(s["S"][:, s["Sn"].index(f"s_os_{st}")]) for st in STEMS}
            for st, v in by.items():
                per[st] += v
            shares = {st: s["S"][at, s["Sn"].index(f"s_long_{st}")].mean() for st in STEMS}
            tot["k"] += k
            tot["K"] += tp(pk)
            tot["best"] += max(by.values())
            tot["floor"] += max(tp(rng.random(len(t))) for _ in STEMS)
            tot["loudest"] += by[max(("other", "vocals", "guitar", "piano"), key=lambda st: shares[st])]
    return {"cover": {k: round(v / tot["k"], 4) for k, v in tot.items() if k != "k"},
            "per_stem": {k: round(v / tot["k"], 4) for k, v in per.items()}, "windows_human": tot["k"]}


def main():
    have = {os.path.basename(p)[:-4] for p in glob.glob(f"{FEAT}/*.pkl")} - {"hd"}
    songs = load(have)
    for s in songs:
        f = pickle.load(open(f"{FEAT}/{s['id']}.pkl", "rb"))
        assert len(f["t"]) == len(s["t"])
        s["S"], s["Sn"], s["Sr"] = f["X"], f["names"], rank_cols(f["X"])
    print(len(songs), "songs", flush=True)
    rng = np.random.default_rng(0)
    fold_of = {s["id"]: int(f) for s, f in zip(songs, rng.permutation(len(songs)) % NFOLD)}
    names = songs[0]["names"] + songs[0]["Sn"]
    k = [names.index(n) for n in K_COLS]
    nb = len(songs[0]["names"])
    allc = list(range(nb))
    st = list(range(nb, len(names)))
    no_note = [j for j in st if "_note" not in names[j]]
    sets = {"K": (k, "lr"), "ALL": (allc, "lr"), "S": (st, "lr"), "K+S": (k + st, "lr"), "K+S_nonotes": (k + no_note, "lr"), "ALL+S": (allc + st, "lr"),
            "K_hgb": (k, "hgb"), "ALL_hgb": (allc, "hgb"), "K+S_hgb": (k + st, "hgb"), "ALL+S_hgb": (allc + st, "hgb")}
    R = {"songs": len(songs), "bar": {}, "levels": {}}
    for lv in LV:
        ss = songs_with(songs, lv)
        X = np.concatenate([np.hstack([s["Xr"], s["Sr"]]) for s in ss])
        y = np.concatenate([s["label"][lv] for s in ss])
        sid = np.concatenate([np.full(len(s["t"]), i) for i, s in enumerate(ss)])
        fold = np.array([fold_of[s["id"]] for s in ss])[sid]
        res, scores = {}, {}
        for name, (cols, kind) in sets.items():
            p = oof(X, y, fold, cols, kind)
            a, f = per_song(p, ss, sid, y, lv)
            scores[name] = (p, a, f)
            res[name] = {"auc": round(float(np.nanmedian(a)), 4), "f1": round(float(np.nanmedian(f)), 4)}
            print(lv, name, res[name], flush=True)
        delta = {}
        for name in sets:
            if name != "K":
                delta[name] = {"f1_vs_K": [round(v, 4) for v in boot(scores[name][2] - scores["K"][2])],
                               "auc_vs_K": [round(v, 4) for v in boot(scores[name][1] - scores["K"][1])]}
        delta["K+S_vs_ALL"] = {"f1": [round(v, 4) for v in boot(scores["K+S"][2] - scores["ALL"][2])]}
        delta["K+S_hgb_vs_ALL_hgb"] = {"f1": [round(v, 4) for v in boot(scores["K+S_hgb"][2] - scores["ALL_hgb"][2])]}
        delta["ALL+S_vs_ALL"] = {"f1": [round(v, 4) for v in boot(scores["ALL+S"][2] - scores["ALL"][2])]}
        single = {n: round(float(np.nanmedian([auc_fast(X[sid == i, j], y[sid == i]) for i in range(len(ss))])), 4)
                  for j, n in enumerate(names) if j >= nb}
        R["levels"][lv] = {"songs": len(ss), "models": res, "delta": delta, "single_auc": single,
                           "windows": window_diagnostics(ss, sid, scores["K"][0], lv)}
        print(lv, json.dumps(delta), flush=True)
        print(lv, "windows", R["levels"][lv]["windows"], flush=True)
    d = {lv: R["levels"][lv]["delta"] for lv in LV}
    R["bar"] = {"gain_over_K": d["normal"]["K+S"]["f1_vs_K"][0] >= .02 and d["normal"]["K+S"]["f1_vs_K"][1] > 0,
                "beats_mix_only": d["normal"]["K+S_vs_ALL"]["f1"][1] > 0,
                "easy_hard_safe": all(d[lv]["K+S"]["f1_vs_K"][0] > -.005 for lv in ("easy", "hard"))}
    print("BAR", R["bar"], flush=True)
    json.dump(R, open(OUTFILE, "w"), indent=1)


if __name__ == "__main__":
    main()
