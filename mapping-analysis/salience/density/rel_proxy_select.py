# What the score does when it selects notes: K with rel_os, K with raw_strength (the best Features v4 proxy of rel_proxy.py), K without
# a strength column. Same candidates, labels, generator grid and folds as rel_proxy.py. Information only; no threshold, no decision.
# Per song, per level: keep the N candidates with the highest out-of-fold K score, N = number of human moments of that song on that level.
#   F1            2 * (distinct human moments within 35 ms of a kept candidate) / (N kept + N human); same formula as common.f1_topk,
#                 but one budget per song instead of one per 8 s window (the brief asked for N per song).
#   beats kept    share of grid beats (ctx.timing, between the first and the last human moment of the level) with a kept note within
#                 70 ms (the tolerance of the meter). Songs without a generator grid are left out of this column. "human" is the same
#                 share for the human moments, as a reference.
#   no sound      the repo's definition (levels/normal/02_slots.py: a slot with no onset detector firing and no event) is empty here by
#                 construction, because every candidate is a Features v4 onset cluster. So: a kept note whose cluster strength
#                 (largest source strength of the cluster) is under 25% of the median cluster strength of its song. The 25% is set here, once.
# In mewbeat-ma. Train songs only. Songs without the level are skipped.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from rel_proxy import proxies  # noqa: E402

OUT = "/cache/rel_proxy_select.json"
BEAT_TOL = 70.0
SOUND_FLOOR = 0.25
VARIANTS = {"rel_os": lambda s, names: s["X"][:, names.index("rel_os")],
            "raw_strength": lambda s, names: s["px"]["raw_strength"],
            "no_strength_col": lambda s, names: np.zeros(len(s["t"]))}


def beats_kept(beats, lo, hi, notes):
    b = np.asarray([x for x in beats if lo <= x <= hi], float)
    if len(b) == 0 or len(notes) == 0:
        return np.nan
    notes = np.sort(notes)
    j = np.clip(np.searchsorted(notes, b), 1, len(notes) - 1)
    d = np.minimum(np.abs(notes[j - 1] - b), np.abs(notes[j] - b))
    return float((d <= BEAT_TOL).mean())


def main():
    ss = songs_train()
    n = len(ss)
    print(n, "train songs; test songs not read", flush=True)
    fold_s = folds(n)
    names = ss[0]["names"]
    for s in ss:
        s["gm"] = gen_meter(s)
        s["px"] = proxies(s)
    R = {"songs": n, "levels": {}}
    for lv in LV:
        sl = [(i, s) for i, s in enumerate(ss) if lv in s["label"]]
        y = np.concatenate([s["label"][lv] for _, s in sl])
        sid = np.concatenate([np.full(len(s["t"]), k) for k, (_, s) in enumerate(sl)])
        fold = np.array([fold_s[i] for i, _ in sl])[sid]
        res = {}
        for vn, colfn in VARIANTS.items():
            X = np.concatenate([rank_cols(np.stack([colfn(s, names)] + [s["gm"][c] for c in K_COLS[1:]], 1)) for _, s in sl])
            p = lr_oof(X, y, fold)
            f1, bk, ns, nk = [], [], [], 0
            rng = np.random.default_rng(0)
            for k, (_, s) in enumerate(sl):
                m = sid == k
                sc = p[m] + 1e-9 * rng.random(m.sum())
                hm = np.asarray(s["human"][lv], float)
                N = min(len(hm), len(sc))
                if N == 0:
                    continue
                sel = np.argsort(-sc)[:N]
                h = s["hidx"][lv][sel]
                f1.append(2 * len(np.unique(h[h >= 0])) / (N + len(hm)))
                strength = s["P"].max(1)
                ns.append(float((strength[sel] < SOUND_FLOOR * np.median(strength)).mean()))
                if s["ph"]["timing"]["snapped"]:
                    bk.append(beats_kept(s["ph"]["timing"]["beats"], hm.min(), hm.max(), s["t"][sel]))
            res[vn] = {"f1_median": round(float(np.median(f1)), 4), "f1_mean": round(float(np.mean(f1)), 4),
                       "beats_kept_mean": round(float(np.nanmean(bk)), 4), "beats_kept_median": round(float(np.nanmedian(bk)), 4),
                       "no_sound_mean": round(float(np.mean(ns)), 4), "no_sound_median": round(float(np.median(ns)), 4),
                       "songs": len(f1), "songs_with_grid": int(np.sum(~np.isnan(bk)))}
            print(lv, vn, res[vn], flush=True)
        hb = [beats_kept(s["ph"]["timing"]["beats"], min(s["human"][lv]), max(s["human"][lv]), np.asarray(s["human"][lv], float))
              for _, s in sl if s["ph"]["timing"]["snapped"] and len(s["human"][lv])]
        res["human"] = {"beats_kept_mean": round(float(np.nanmean(hb)), 4), "beats_kept_median": round(float(np.nanmedian(hb)), 4)}
        print(lv, "human", res["human"], flush=True)
        R["levels"][lv] = {"songs": len(sl), "skipped_without_level": n - len(sl), **res}
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
