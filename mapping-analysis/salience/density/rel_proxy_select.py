# What the score does when it selects notes: K with rel_os, K with raw_strength (the best Features v4 proxy of rel_proxy.py), K without
# a strength column. Same candidates, labels, generator grid and folds as rel_proxy.py; the out-of-fold K scores are computed once per
# variant and level and reused by all budgets. Information only; no threshold, no decision.
# Three selection budgets (N = human moments of the level inside the budget unit; keep the N candidates of that unit with the best score):
#   song    one budget per song (the first version of this script).
#   window  8 s windows over the song, N per window; the exact selection of common.f1_topk (copied, and asserted equal to it per song).
#   phrase  phrases of analyse() (s["ph"]["phrases"]) as in phrase_density.py: length >= 2 s, inside the first..last human moment of the
#           level; N per phrase = human moments in [startMs, endMs). Candidates outside those phrases are never kept. F1 and the
#           beat shares use only the human moments (and beats) inside the kept phrases. Songs with no such phrase are skipped.
#   F1            2 * (distinct human moments within 35 ms of a kept candidate) / (N kept + N human); same formula as common.f1_topk.
#   beats kept    share of grid beats (ctx.timing; between the first and the last human moment for song and window, inside the phrases
#                 for phrase) with a kept note within 70 ms (the tolerance of the meter). Songs without a generator grid are left out of
#                 this column. "human" is the same share for the human moments, as a reference.
#   no sound      (song budget only) the repo's definition (levels/normal/02_slots.py: a slot with no onset detector firing and no
#                 event) is empty here by construction, because every candidate is a Features v4 onset cluster. So: a kept note whose
#                 cluster strength (largest source strength of the cluster) is under 25% of the median cluster strength of its song.
#   paired        per song rel_os minus raw_strength, for F1 and for the absolute gap |beats kept - human beats kept|; median and mean
#                 with a bootstrap 95% CI over songs (seed 0, 2000 resamples).
# Reproduction check (window budget only): K as in salience/d_subset.py (five columns rel_os, m_beat, m_half, m_quarter, d_grid; meter of
# the pkl; max_iter 300; f1_topk seed = index of the song in the level list), on the 80 train songs, to compare with RESULTS.md.
# In mewbeat-ma. Train songs only. Songs without the level are skipped.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from common import f1_topk, WIN  # noqa: E402
from rel_proxy import proxies  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

OUT = "/cache/rel_proxy_select.json"
BEAT_TOL = 70.0
SOUND_FLOOR = 0.25
MIN_PHRASE_MS = 2000
NBOOT = 2000
VARIANTS = {"rel_os": lambda s, names: s["X"][:, names.index("rel_os")],
            "raw_strength": lambda s, names: s["px"]["raw_strength"],
            "no_strength_col": lambda s, names: np.zeros(len(s["t"]))}
# (columns of the pkl, source of the meter, max_iter); evaluated with the window budget only
DIAG = {"repro_pkl5_it300": (["rel_os", "m_beat", "m_half", "m_quarter", "d_grid"], "pkl", 300),
        "diag_gen5_it300": (["rel_os", "m_beat", "m_half", "m_quarter", "d_grid"], "gen", 300),
        "diag_pkl7_it400": (K_COLS, "pkl", 400)}


def beats_arr(b, notes):
    b = np.asarray(b, float)
    if len(b) == 0 or len(notes) == 0:
        return np.nan
    notes = np.sort(np.asarray(notes, float))
    j = np.clip(np.searchsorted(notes, b), 1, len(notes) - 1)
    d = np.minimum(np.abs(notes[j - 1] - b), np.abs(notes[j] - b))
    return float((d <= BEAT_TOL).mean())


def lr_oof_it(X, y, fold, it):
    p = np.zeros(len(y))
    for f in range(NFOLD):
        tr, te = fold != f, fold == f
        if y[tr].sum() == 0:
            continue
        p[te] = LogisticRegression(C=1.0, max_iter=it).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return p


def sel_song(s, lv, p, rng):
    sc = p + 1e-9 * rng.random(len(p))
    hm = np.asarray(s["human"][lv], float)
    N = min(len(hm), len(sc))
    if N == 0:
        return None
    sel = np.argsort(-sc)[:N]
    h = s["hidx"][lv][sel]
    return dict(f1=2 * len(np.unique(h[h >= 0])) / (N + len(hm)), sel=sel, hum=hm, spans=[(hm.min(), hm.max())])


def sel_window(s, lv, p, seed):
    """copy of common.f1_topk that also returns the kept candidates."""
    t, hm, hidx = s["t"], np.asarray(s["human"][lv]), s["hidx"][lv]
    if len(hm) == 0:
        return None
    sc = p + 1e-7 * np.random.default_rng(seed).random(len(p))
    win = (t // WIN).astype(int)
    nwin = max(win.max(), int(hm.max() // WIN)) + 1
    k = np.bincount((hm // WIN).astype(int), minlength=nwin)
    order = np.lexsort((-sc, win))
    ws = win[order]
    first = np.searchsorted(ws, ws, side="left")
    rk = np.arange(len(order)) - first
    sel = order[rk < k[ws]]
    h = hidx[sel]
    f1 = 2 * len(np.unique(h[h >= 0])) / (len(sel) + len(hm))
    assert abs(f1 - f1_topk(t, p, hidx, hm, seed=seed)) < 1e-12
    hm = hm.astype(float)
    return dict(f1=f1, sel=sel, hum=hm, spans=[(hm.min(), hm.max())])


def phrases_of(s, lv):
    hm = np.asarray(s["human"][lv], float)
    if len(hm) < 2:
        return []
    lo, hi = hm.min(), hm.max()
    return [(p["startMs"], p["endMs"]) for p in s["ph"]["phrases"]
            if p["endMs"] - p["startMs"] >= MIN_PHRASE_MS and p["startMs"] >= lo and p["endMs"] <= hi]


def sel_phrase(s, lv, p, seed):
    spans = phrases_of(s, lv)
    if not spans:
        return None
    t, hm, hidx = s["t"], np.asarray(s["human"][lv], float), s["hidx"][lv]
    sc = p + 1e-7 * np.random.default_rng(seed).random(len(p))
    kept, inh = [], np.zeros(len(hm), bool)
    for a, b in spans:
        hin = (hm >= a) & (hm < b)
        inh |= hin
        N = int(hin.sum())
        idx = np.where((t >= a) & (t < b))[0]
        kept.append(idx[np.argsort(-sc[idx])[:N]])
    sel = np.concatenate(kept)
    nh = int(inh.sum())
    if nh == 0:
        return None
    h = hidx[sel]
    h = h[h >= 0]
    h = np.unique(h[inh[h]])
    return dict(f1=2 * len(h) / (len(sel) + nh), sel=sel, hum=hm[inh], spans=spans)


def beats_in(s, spans):
    tm = s["ph"]["timing"]
    b = np.asarray(tm["beats"] if tm["snapped"] else [], float)
    if len(b) == 0:
        return b
    return b[np.any([(b >= a) & (b <= z) for a, z in spans], axis=0)]


def boot(d):
    d = np.asarray(d, float)
    d = d[~np.isnan(d)]
    idx = np.random.default_rng(0).integers(0, len(d), (NBOOT, len(d)))
    bs = d[idx]
    med, mean = np.median(bs, 1), bs.mean(1)
    ci = lambda v: [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]
    return {"n": len(d), "median": round(float(np.median(d)), 4), "median_ci": ci(med),
            "mean": round(float(d.mean()), 4), "mean_ci": ci(mean)}


def main():
    ss = songs_train()
    n = len(ss)
    print(n, "train songs; test songs not read", flush=True)
    fold_s = folds(n)
    names = ss[0]["names"]
    for s in ss:
        s["gm"] = gen_meter(s)
        s["px"] = proxies(s)
    R = {"songs": n, "budgets": {"song": {}, "window": {}, "phrase": {}}}
    for lv in LV:
        sl = [(i, s) for i, s in enumerate(ss) if lv in s["label"]]
        m_ = len(sl)
        y = np.concatenate([s["label"][lv] for _, s in sl])
        sid = np.concatenate([np.full(len(s["t"]), k) for k, (_, s) in enumerate(sl)])
        fold = np.array([fold_s[i] for i, _ in sl])[sid]
        scores = {}
        for vn, colfn in VARIANTS.items():
            X = np.concatenate([rank_cols(np.stack([colfn(s, names)] + [s["gm"][c] for c in K_COLS[1:]], 1)) for _, s in sl])
            scores[vn] = lr_oof(X, y, fold)
        for vn, (cols, msrc, it) in DIAG.items():
            j = [names.index(c) for c in cols]
            if msrc == "pkl":
                X = np.concatenate([s["Xr"][:, j] for _, s in sl])
            else:
                X = np.concatenate([rank_cols(np.stack([s["X"][:, names.index("rel_os")]] + [s["gm"][c] for c in cols[1:]], 1)) for _, s in sl])
            scores[vn] = lr_oof_it(X, y, fold, it)
        for bud in ("song", "window", "phrase"):
            rec = {}
            hb = np.full(m_, np.nan)
            vlist = list(VARIANTS) + (list(DIAG) if bud == "window" else [])
            for vn in vlist:
                f1 = np.full(m_, np.nan)
                bk = np.full(m_, np.nan)
                ns = np.full(m_, np.nan)
                rng = np.random.default_rng(0)
                for k, (_, s) in enumerate(sl):
                    p = scores[vn][sid == k]
                    r = sel_song(s, lv, p, rng) if bud == "song" else sel_window(s, lv, p, k) if bud == "window" else sel_phrase(s, lv, p, k)
                    if r is None:
                        continue
                    f1[k] = r["f1"]
                    if bud == "song":
                        strength = s["P"].max(1)
                        ns[k] = float((strength[r["sel"]] < SOUND_FLOOR * np.median(strength)).mean())
                    if s["ph"]["timing"]["snapped"]:
                        b = beats_in(s, r["spans"])
                        bk[k] = beats_arr(b, s["t"][r["sel"]])
                        if vn == "rel_os":
                            hb[k] = beats_arr(b, r["hum"])
                rec[vn] = dict(f1=f1, bk=bk, ns=ns)
            out = {"songs": int((~np.isnan(rec["rel_os"]["f1"])).sum()), "skipped_without_level": n - m_,
                   "skipped_no_budget": int(np.isnan(rec["rel_os"]["f1"]).sum())}
            for vn in vlist:
                f1, bk, ns = rec[vn]["f1"], rec[vn]["bk"], rec[vn]["ns"]
                o = {"f1_median": round(float(np.nanmedian(f1)), 4), "f1_mean": round(float(np.nanmean(f1)), 4),
                     "beats_kept_mean": round(float(np.nanmean(bk)), 4), "beats_kept_median": round(float(np.nanmedian(bk)), 4),
                     "songs_with_grid": int((~np.isnan(bk)).sum())}
                if bud == "song":
                    o.update(no_sound_mean=round(float(np.nanmean(ns)), 4), no_sound_median=round(float(np.nanmedian(ns)), 4))
                out[vn] = o
                print(bud, lv, vn, o, flush=True)
            out["human"] = {"beats_kept_mean": round(float(np.nanmean(hb)), 4), "beats_kept_median": round(float(np.nanmedian(hb)), 4),
                            "songs_with_grid": int((~np.isnan(hb)).sum())}
            print(bud, lv, "human", out["human"], flush=True)
            a, b = rec["rel_os"], rec["raw_strength"]
            gap = lambda r: np.abs(r["bk"] - hb)
            out["paired_rel_os_minus_raw_strength"] = {
                "f1": boot(a["f1"] - b["f1"]), "beat_gap": boot(gap(a) - gap(b)),
                "beat_gap_mean_rel_os": round(float(np.nanmean(gap(a))), 4), "beat_gap_mean_raw_strength": round(float(np.nanmean(gap(b))), 4),
                "beat_gap_median_rel_os": round(float(np.nanmedian(gap(a))), 4), "beat_gap_median_raw_strength": round(float(np.nanmedian(gap(b))), 4)}
            print(bud, lv, "paired", out["paired_rel_os_minus_raw_strength"], flush=True)
            R["budgets"][bud][lv] = out
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
