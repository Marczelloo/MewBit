# Weights of K for the Java plugin / the generator: one logistic regression per level (E/N/H), fitted on all 80 train songs.
# Variant chosen by A (rel_proxy.log): no Features v4 proxy replaces rel_os, so K keeps rel_os, with the meter taken on the
# generator's beat grid (ctx.timing). Writes only /density/k_weights.json. Train songs only.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403

OUT = "/density/k_weights.json"


def main():
    ss = songs_train()
    names = ss[0]["names"]
    out = {
        "variant": "rel_os + meter on the generator grid (ctx.timing); chosen because no Features v4 proxy was within -.01 AUC of rel_os (rel_proxy.log)",
        "features": K_COLS,
        "model": "sklearn LogisticRegression(C=1, max_iter=400); score = intercept + sum(coef[i] * x[i]); probability = 1 / (1 + exp(-score)); rank candidates by score",
        "rank": ("Every column is turned into a within-song rank before scoring. Columns with more than 2 distinct values in the song: average rank "
                 "(ties get the mean of their ranks, 1-based) divided by the number of candidates n of that song, so the values lie in (0, 1]. "
                 "Columns with at most 2 distinct values (the binary meter flags) stay raw. Same as common.rank_cols; scipy.stats.rankdata(method='average') / n."),
        "candidates": "30 ms clusters of Features v4 onsets (extract.candidates); label = a human note of that level within 35 ms",
        "train_songs": len(ss),
        "levels": {},
    }
    for lv in LV:
        sl = [s for s in ss if lv in s["label"]]
        Xs, ys = [], []
        for s in sl:
            gm = gen_meter(s)
            raw = np.stack([s["X"][:, names.index("rel_os")]] + [gm[c] for c in K_COLS[1:]], 1)
            Xs.append(rank_cols(raw))
            ys.append(s["label"][lv])
        X, y = np.concatenate(Xs), np.concatenate(ys)
        m = LogisticRegression(C=1.0, max_iter=400).fit(X, y)
        out["levels"][lv] = {"songs": len(sl), "skipped_without_level": len(ss) - len(sl), "candidates": int(len(y)), "positive_rate": round(float(y.mean()), 4),
                             "coef": [round(float(c), 6) for c in m.coef_[0]], "intercept": round(float(m.intercept_[0]), 6)}
        print(lv, out["levels"][lv], flush=True)
    json.dump(out, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
