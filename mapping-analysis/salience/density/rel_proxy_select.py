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
# Counting-artifact check (phrase budget; rel_os and raw_strength): (1) precision (picks that hit a human note / picks), recall (distinct
# human notes hit / human notes) and the share of picks that hit an already-hit human note; (2) the same plus F1, beat share and the paired
# CI when selection is greedy by score and skips any candidate within 70 ms (<=) of a pick already made in the song, with how often a phrase
# runs out of candidates; (3) per-song AUC after keeping one positive candidate per human note (the best-scoring one by the variant's own
# score, or the one nearest in time) and dropping the other positives, against the AUC over all candidates.
# Gap sweep (fix round 2; phrase budget; rel_os and raw_strength; "sweep" lines): the greedy selection with a gap of 0, 35, 50, 70, 100 ms,
# the generator's own minimum note gap ("real"; "tempo" adds the tempo-relative gap of the pattern path), and the same with the candidates
# snapped to the generator grid first ("snap_*"); definitions next to sweep(). Per row: F1 median of both, paired median difference with a
# bootstrap CI, notes the greedy could not fill (shortfall) and the share of human moves closer than the gap to the previous move (recall cap).
# Mechanism test (fix round 2; "mechanism" lines): (a) share of candidate pairs under 35 ms apart whose rel_os (width 5, from the pkl) or
# raw_strength is equal or nearly equal (reference: pairs 100-200 ms apart); (b) rel_os rebuilt from the audio at max-filter widths 1, 3 and 5
# (width 5 checked against the pkl), K refitted with the same folds: duplicate share, F1 and AUC; (c) the share of candidates at
# raw_strength = 1.0 (saturation), also among positives, negatives and the picks of the plain top-N.
# In mewbeat-ma. Train songs only. Songs without the level are skipped.
import sys, json, bisect
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from common import f1_topk, WIN, auc_fast, nearest_human  # noqa: E402
from rel_proxy import proxies  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

OUT = "/cache/rel_proxy_select.json"
BEAT_TOL = 70.0
SOUND_FLOOR = 0.25
MIN_PHRASE_MS = 2000
GREEDY_GAP = 70.0
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


def sel_phrase(s, lv, p, seed, greedy=False, gap=None, tt=None, hh=None, alive=None):
    """greedy: candidates in order of score, a candidate within `gap` ms (<=; default GREEDY_GAP) of a pick already made (anywhere in
    the song) is skipped. tt / hh / alive: candidate times, their nearest-human index and a mask of the candidates that exist (the
    snapped variant of the sweep); by default the Features v4 candidates."""
    spans = phrases_of(s, lv)
    if not spans:
        return None
    gap = GREEDY_GAP if gap is None else gap
    t = s["t"] if tt is None else tt
    hm, hidx = np.asarray(s["human"][lv], float), (s["hidx"][lv] if hh is None else hh)
    sc = p + 1e-7 * np.random.default_rng(seed).random(len(p))
    kept, inh, acc, n_short, short_notes = [], np.zeros(len(hm), bool), [], 0, 0
    for a, b in spans:
        hin = (hm >= a) & (hm < b)
        inh |= hin
        N = int(hin.sum())
        ok = (t >= a) & (t < b)
        if alive is not None:
            ok &= alive
        idx = np.where(ok)[0]
        order = idx[np.argsort(-sc[idx])]
        if not greedy:
            pick = order[:N]
        else:
            pick = []
            for c in order:
                if len(pick) >= N:
                    break
                j = bisect.bisect_left(acc, t[c])
                if (j < len(acc) and acc[j] - t[c] <= gap) or (j > 0 and t[c] - acc[j - 1] <= gap):
                    continue
                pick.append(c)
                bisect.insort(acc, t[c])
            pick = np.asarray(pick, int)
        n_short += int(len(pick) < N)
        short_notes += N - len(pick)
        kept.append(pick)
    sel = np.concatenate(kept).astype(int)
    nh = int(inh.sum())
    if nh == 0:
        return None
    h = hidx[sel]
    hit = (h >= 0)
    hit[hit] = inh[h[hit]]
    dist = len(np.unique(h[hit]))
    ns = max(len(sel), 1)
    prev = np.concatenate([[np.inf], np.diff(hm)])  # time from each human moment to the previous one of the song
    return dict(f1=2 * dist / (len(sel) + nh), sel=sel, hum=hm[inh], spans=spans, prec=hit.sum() / ns, rec=dist / nh,
                dup=(hit.sum() - dist) / ns, nph=len(spans), n_short=n_short, short_notes=short_notes, nh=nh, dtprev=prev[inh])


def dedupe_auc(s, lv, p, mode):
    """per-song AUC after keeping, per human note, one positive candidate (own: best score; nearest: closest in time) and dropping the other positives."""
    t, h, hm = s["t"], s["hidx"][lv], np.asarray(s["human"][lv], float)
    pos = h >= 0
    keep = ~pos
    for u in np.unique(h[pos]):
        c = np.where(h == u)[0]
        keep[c[np.argmax(p[c]) if mode == "own" else np.argmin(np.abs(t[c] - hm[u]))]] = True
    return auc_fast(p[keep], pos[keep].astype(int)), int(pos.sum() - (pos & keep).sum()), int(pos.sum())


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


# ---- gap sweep (fix round 2): greedy selection with a minimum gap between picks --------------------------------------------------------
# The generator's own gaps (helpers/mewbeat/charts/difficulty.js, final pass enforceFloors / spacedMoments in difficultyFilter.js):
# minNoteGapMs = easy 130, normal 100, hard 60 ms between any two distinct times, whatever the lane; on the pattern path also gapBeats
# (easy 1/2, normal 1/4 beat, x GRID_SLACK 0.9; hard none). Rows: fixed gaps, "real" = minNoteGapMs, "tempo" = max(minNoteGapMs,
# gapBeats * 0.9 * median beat of the generator grid) for easy and normal, "snap_*" = the candidates are first moved to the level's grid
# like bandPath.snapToGrid (grid division 2 / 2 / 4 per beat, 8 for a candidate with strength >= 0.9 on hard; moved only if the grid point is
# within 35 ms and the beat length there is within 25% of the median), candidates on the same grid time collapse into the one with the best
# score, then greedy with the gap. Hits are counted against the snapped times (35 ms). Songs with no grid keep the raw times.
REAL_GAP = {"easy": 130.0, "normal": 100.0, "hard": 60.0}
GAP_BEATS = {"easy": 0.5, "normal": 0.25}
GRID_SLACK = 0.9
DIVS = {"easy": (2, None), "normal": (2, None), "hard": (4, 8)}
FINE_MIN, SNAP_MAX, INTERVAL_TOL = 0.9, 35.0, 0.25
SWEEP_GAPS = (0.0, 35.0, 50.0, 70.0, 100.0)


def tempo_gap(s, lv):
    tm = s["ph"]["timing"]
    med = float(tm["medianMs"]) if tm["snapped"] else 500.0
    return max(REAL_GAP[lv], GAP_BEATS[lv] * GRID_SLACK * med)


def snap_cands(s, lv):
    """candidate times after the snap of bandPath.snapToGrid (timing.gridPoints / intervalOk rebuilt from the dumped extended beats)."""
    t, tm = s["t"], s["ph"]["timing"]
    if not tm["snapped"]:
        return t.copy()
    ext, med = np.asarray(tm["beats"], float), float(tm["medianMs"])
    base, fine = DIVS[lv]
    divs = np.where(s["P"].max(1) >= FINE_MIN, fine, base) if fine else np.full(len(t), base)

    def grid(div):
        g = np.floor(ext[:-1, None] + np.arange(div)[None, :] * (np.diff(ext) / div)[:, None] + 0.5).ravel()
        return np.append(g, ext[-1])

    def ok(x):
        i = np.clip(np.searchsorted(ext, x + 1 + 1e-9, side="left") - 1, 0, len(ext) - 2)
        return np.abs((ext[i + 1] - ext[i]) - med) <= INTERVAL_TOL * med

    out = t.copy()
    for div in np.unique(divs):
        g = grid(int(div))
        i = np.clip(np.searchsorted(g, t), 1, len(g) - 1)
        near = np.where(np.abs(t - g[i - 1]) <= np.abs(t - g[i]), g[i - 1], g[i])
        use = (divs == div) & (np.abs(near - t) <= SNAP_MAX) & ok(t) & ok(near)
        out = np.where(use, near, out)
    return out


def collapse(tt, p):
    """True for the best-scored candidate of each snapped time."""
    o = np.lexsort((-p, tt))
    alive = np.zeros(len(tt), bool)
    alive[o[0]] = True
    alive[o[1:]] = tt[o][1:] != tt[o][:-1]
    return alive


def sweep(sl, lv, scores, sid):
    m_ = len(sl)
    rows = [(f"g{int(g)}", (lambda s, g=g: g), False) for g in SWEEP_GAPS]
    rows.append(("real", lambda s: REAL_GAP[lv], False))
    if lv in GAP_BEATS:
        rows.append(("tempo", lambda s: tempo_gap(s, lv), False))
    rows += [("snap_g0", lambda s: 0.0, True), ("snap_real", lambda s: REAL_GAP[lv], True)]
    snapc = []
    for _, s in sl:
        tt = snap_cands(s, lv)
        snapc.append((tt, nearest_human(tt, np.asarray(s["human"][lv], float))))
    out = {}
    for name, gfn, snap in rows:
        res, cap = {}, dict(lt=0, le=0, n=0)
        gaps = []
        for vn in ("rel_os", "raw_strength"):
            c = {q: np.full(m_, np.nan) for q in ("f1", "short", "nshort", "nh", "dup", "prec", "rec", "nph")}
            for k, (_, s) in enumerate(sl):
                p = scores[vn][sid == k]
                g = gfn(s)
                if snap:
                    tt, hh = snapc[k]
                    r = sel_phrase(s, lv, p, k, greedy=True, gap=g, tt=tt, hh=hh, alive=collapse(tt, p))
                else:
                    r = sel_phrase(s, lv, p, k, greedy=True, gap=g)
                if r is None:
                    continue
                if name == "g0":
                    assert abs(r["f1"] - sel_phrase(s, lv, p, k)["f1"]) < 1e-12
                for q, v in (("f1", r["f1"]), ("short", r["n_short"]), ("nshort", r["short_notes"]), ("nh", r["nh"]), ("dup", r["dup"]),
                             ("prec", r["prec"]), ("rec", r["rec"]), ("nph", r["nph"])):
                    c[q][k] = v
                if vn == "rel_os":
                    gaps.append(g)
                    cap["lt"] += int((r["dtprev"] < g).sum())
                    cap["le"] += int((r["dtprev"] <= g).sum())
                    cap["n"] += len(r["dtprev"])
            res[vn] = c
        a, b = res["rel_os"], res["raw_strength"]
        o = {"gap_ms_mean": round(float(np.mean(gaps)), 1), "snap": snap, "songs": int((~np.isnan(a["f1"])).sum())}
        for vn, c in res.items():
            o[vn] = {"f1_median": round(float(np.nanmedian(c["f1"])), 4), "f1_mean": round(float(np.nanmean(c["f1"])), 4),
                     "precision_mean": round(float(np.nanmean(c["prec"])), 4), "recall_mean": round(float(np.nanmean(c["rec"])), 4),
                     "duplicate_share_mean": round(float(np.nanmean(c["dup"])), 4),
                     "phrases": int(np.nansum(c["nph"])), "phrases_short": int(np.nansum(c["short"])),
                     "notes_short": int(np.nansum(c["nshort"])), "human_notes": int(np.nansum(c["nh"])),
                     "notes_short_share": round(float(np.nansum(c["nshort"]) / np.nansum(c["nh"])), 4)}
        o["paired_rel_os_minus_raw_strength_f1"] = boot(a["f1"] - b["f1"])
        o["human_closer_than_gap_share_lt"] = round(cap["lt"] / cap["n"], 4)
        o["human_closer_than_gap_share_le"] = round(cap["le"] / cap["n"], 4)
        o["human_moves"] = cap["n"]
        out[name] = o
        print("sweep", lv, name, json.dumps(o), flush=True)
    return out


# ---- mechanism test (fix round 2) --------------------------------------------------------------------------------------------------------
WIDTHS = (1, 3, 5)
SAT = 1.0 - 1e-6


def mel_cols(s):
    """rel_os with max-filter widths WIDTHS, rebuilt from the audio exactly as extract.build does (mel onset strength / 2 s mean, per-song
    mel lag chosen on the z-scored onset strength at the candidates, max filter, lookup at candidate time + lag). Width 5 must equal the pkl."""
    import glob as _g, librosa
    import scipy.ndimage as ndi
    sr, hop = 22050, 256
    fms = 1000.0 * hop / sr
    y, _ = librosa.load(_g.glob(f"{DATA}/audio/{s['id']}.*")[0], sr=sr, mono=True)
    y = y / (np.abs(y).max() + 1e-9)
    o = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    T = len(o)
    rel = o / (ndi.uniform_filter1d(o, int(round(2000 / fms)), mode="nearest") + 1e-6)
    z = (o - o.mean()) / (o.std() + 1e-9)
    base = np.round(s["t"] / fms).astype(int)
    lags = list(range(-8, 9))
    shift = lags[int(np.argmax([z[np.clip(base + L, 0, T - 1)].mean() for L in lags]))] * fms
    fr = np.clip(np.round((s["t"] + shift) / fms).astype(int), 0, T - 1)
    return {w: (rel if w == 1 else ndi.maximum_filter1d(rel, w))[fr] for w in WIDTHS}, shift


def pair_stats(ss, getters):
    from scipy.stats import rankdata
    out = {}
    for name, fn in getters.items():
        a_ = {q: 0 for q in ("pairs", "near", "eq", "c1", "c5", "rk", "far", "far_eq", "far_c1", "far_c5", "far_rk", "cand", "cand_nb")}
        for s in ss:
            o = np.argsort(s["t"], kind="stable")
            t, v = s["t"][o], fn(s).astype(np.float64)[o]
            rk = rankdata(v, method="average") / len(v)
            dt = np.diff(t)
            x, y_ = v[:-1], v[1:]
            mx = np.maximum(np.maximum(np.abs(x), np.abs(y_)), 1e-12)
            near, far = dt < 35, (dt >= 100) & (dt < 200)
            tests = {"eq": x == y_, "c1": np.abs(x - y_) <= 0.01 * mx, "c5": np.abs(x - y_) <= 0.05 * mx, "rk": np.abs(rk[:-1] - rk[1:]) <= 0.01}
            a_["pairs"] += len(dt)
            a_["near"] += int(near.sum())
            a_["far"] += int(far.sum())
            for q, m in tests.items():
                a_[q] += int((m & near).sum())
                a_["far_" + q] += int((m & far).sum())
            nb = np.zeros(len(t), bool)
            nb[:-1] |= near
            nb[1:] |= near
            a_["cand"] += len(t)
            a_["cand_nb"] += int(nb.sum())
        out[name] = {"pairs_under_35ms": a_["near"], "candidates_with_neighbour_under_35ms": round(a_["cand_nb"] / a_["cand"], 4),
                     "near_equal": round(a_["eq"] / a_["near"], 4), "near_within_1pct": round(a_["c1"] / a_["near"], 4),
                     "near_within_5pct": round(a_["c5"] / a_["near"], 4), "near_rank_within_.01": round(a_["rk"] / a_["near"], 4),
                     "ref_pairs_100_200ms": a_["far"], "ref_equal": round(a_["far_eq"] / a_["far"], 4),
                     "ref_within_1pct": round(a_["far_c1"] / a_["far"], 4), "ref_within_5pct": round(a_["far_c5"] / a_["far"], 4),
                     "ref_rank_within_.01": round(a_["far_rk"] / a_["far"], 4)}
        print("mechanism pairs", name, json.dumps(out[name]), flush=True)
    return out


def mechanism(ss, keep):
    names0 = ss[0]["names"]
    R = {}
    # ---- saturation of raw_strength
    allst = np.concatenate([s["P"].max(1) for s in ss])
    sat = allst >= SAT
    per = np.array([(s["P"].max(1) >= SAT).mean() for s in ss])
    R["saturation"] = {"candidates": int(len(allst)), "strength_max": round(float(allst.max()), 4), "share_at_1": round(float(sat.mean()), 4),
                       "share_ge_.99": round(float((allst >= 0.99).mean()), 4), "share_ge_.9": round(float((allst >= 0.9).mean()), 4),
                       "per_song_share_min": round(float(per.min()), 4), "per_song_share_median": round(float(np.median(per)), 4),
                       "per_song_share_max": round(float(per.max()), 4), "quantiles_.5_.9_.99": [round(float(q), 4) for q in np.quantile(allst, [.5, .9, .99])]}
    print("mechanism saturation", json.dumps(R["saturation"]), flush=True)
    for lv, (sl, sid, fold, scores) in keep.items():
        picks_sat, picks_n, pos_sat, neg_sat = 0, 0, [], []
        for k, (_, s) in enumerate(sl):
            st = s["P"].max(1)
            r = sel_phrase(s, lv, scores["raw_strength"][sid == k], k)
            if r is not None:
                picks_sat += int((st[r["sel"]] >= SAT).sum())
                picks_n += len(r["sel"])
            lab = s["label"][lv] == 1
            pos_sat.append(((st >= SAT) & lab).sum()), neg_sat.append(((st >= SAT) & ~lab).sum())
        npos = sum(int((s["label"][lv] == 1).sum()) for _, s in sl)
        nall = sum(len(s["t"]) for _, s in sl)
        R["saturation"][lv] = {"share_of_raw_strength_picks_at_1": round(picks_sat / picks_n, 4), "share_of_positives_at_1": round(sum(pos_sat) / npos, 4),
                               "share_of_negatives_at_1": round(sum(neg_sat) / (nall - npos), 4)}
        print("mechanism saturation", lv, json.dumps(R["saturation"][lv]), flush=True)
    # ---- rel_os rebuilt from the audio at max-filter widths 1, 3, 5
    err = 0.0
    for s in ss:
        s["os_w"], _ = mel_cols(s)
        pk = s["X"][:, names0.index("rel_os")].astype(np.float64)
        err = max(err, float(np.max(np.abs(s["os_w"][5] - pk) / (np.abs(pk) + 1e-6))))
    R["rebuild_width5_vs_pkl_max_rel_error"] = round(err, 6)
    print("mechanism rebuild width 5 vs pkl rel_os: max relative error", err, flush=True)
    getters = {"rel_os_width5_pkl": lambda s: s["X"][:, names0.index("rel_os")], "raw_strength": lambda s: s["P"].max(1)}
    getters.update({f"rel_os_width{w}_audio": (lambda s, w=w: s["os_w"][w]) for w in WIDTHS})
    R["pairs"] = pair_stats(ss, getters)
    R["width"] = {}
    for lv, (sl, sid, fold, scores) in keep.items():
        y = np.concatenate([s["label"][lv] for _, s in sl])
        m_ = len(sl)
        res = {}
        pw_all = {}
        for w in WIDTHS:
            X = np.concatenate([rank_cols(np.stack([s["os_w"][w]] + [s["gm"][c] for c in K_COLS[1:]], 1)) for _, s in sl])
            pw_all[f"rel_os_width{w}"] = lr_oof(X, y, fold)
        pw_all["raw_strength"] = scores["raw_strength"]
        for vn, pv in pw_all.items():
            c = {q: np.full(m_, np.nan) for q in ("f1", "dup", "f1g", "f1r", "auc")}
            for k, (_, s) in enumerate(sl):
                p = pv[sid == k]
                r = sel_phrase(s, lv, p, k)
                if r is None:
                    continue
                c["f1"][k], c["dup"][k] = r["f1"], r["dup"]
                c["f1g"][k] = sel_phrase(s, lv, p, k, greedy=True)["f1"]
                c["f1r"][k] = sel_phrase(s, lv, p, k, greedy=True, gap=REAL_GAP[lv])["f1"]
                c["auc"][k] = auc_fast(p, s["label"][lv])
            res[vn] = c
        o = {}
        for vn, c in res.items():
            o[vn] = {"f1_median_plain": round(float(np.nanmedian(c["f1"])), 4), "duplicate_share_mean_plain": round(float(np.nanmean(c["dup"])), 4),
                     "f1_median_greedy70": round(float(np.nanmedian(c["f1g"])), 4), "f1_median_greedy_real": round(float(np.nanmedian(c["f1r"])), 4),
                     "auc_mean": round(float(np.nanmean(c["auc"])), 4)}
            if vn != "raw_strength":
                o[vn]["paired_minus_raw_strength_plain"] = boot(c["f1"] - res["raw_strength"]["f1"])
                o[vn]["paired_minus_raw_strength_real"] = boot(c["f1r"] - res["raw_strength"]["f1r"])
            print("mechanism width", lv, vn, json.dumps(o[vn]), flush=True)
        R["width"][lv] = o
    return R


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
    keep = {}
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
        # ---- counting-artifact check (phrase budget): duplicates, greedy selection with a 70 ms exclusion, AUC with one positive per human note
        chk = {}
        res, hb = {}, np.full(m_, np.nan)
        for mode in ("plain", "greedy"):
            for vn in ("rel_os", "raw_strength"):
                cols = {c: np.full(m_, np.nan) for c in ("f1", "bk", "prec", "rec", "dup", "n_short", "nph", "short_notes", "nh", "nsel")}
                for k, (_, s) in enumerate(sl):
                    r = sel_phrase(s, lv, scores[vn][sid == k], k, greedy=(mode == "greedy"))
                    if r is None:
                        continue
                    for c in ("f1", "prec", "rec", "dup", "n_short", "nph", "short_notes", "nh"):
                        cols[c][k] = r[c]
                    cols["nsel"][k] = len(r["sel"])
                    if s["ph"]["timing"]["snapped"]:
                        b = beats_in(s, r["spans"])
                        cols["bk"][k] = beats_arr(b, s["t"][r["sel"]])
                        if mode == "plain" and vn == "rel_os":
                            hb[k] = beats_arr(b, r["hum"])
                res[(mode, vn)] = cols
        gap = lambda c: np.abs(c["bk"] - hb)
        for mode in ("plain", "greedy"):
            o = {}
            for vn in ("rel_os", "raw_strength"):
                c = res[(mode, vn)]
                o[vn] = {"f1_median": round(float(np.nanmedian(c["f1"])), 4), "f1_mean": round(float(np.nanmean(c["f1"])), 4),
                         "beats_kept_mean": round(float(np.nanmean(c["bk"])), 4),
                         "precision_mean": round(float(np.nanmean(c["prec"])), 4), "recall_mean": round(float(np.nanmean(c["rec"])), 4),
                         "duplicate_share_mean": round(float(np.nanmean(c["dup"])), 4),
                         "duplicate_share_pooled": round(float(np.nansum(c["dup"] * c["nsel"]) / np.nansum(c["nsel"])), 4),
                         "picks": int(np.nansum(c["nsel"])), "human_notes": int(np.nansum(c["nh"])),
                         "phrases": int(np.nansum(c["nph"])), "phrases_short": int(np.nansum(c["n_short"])),
                         "notes_short": int(np.nansum(c["short_notes"]))}
            a, b = res[(mode, "rel_os")], res[(mode, "raw_strength")]
            o["paired_rel_os_minus_raw_strength"] = {"f1": boot(a["f1"] - b["f1"]), "beat_gap": boot(gap(a) - gap(b))}
            o["human_beats_kept_mean"] = round(float(np.nanmean(hb)), 4)
            chk[mode] = o
            print("check", lv, mode, json.dumps(o), flush=True)
        auc = {}
        for vn in ("rel_os", "raw_strength"):
            for mode in ("all", "own", "nearest"):
                v, dropped, npos = np.full(m_, np.nan), 0, 0
                for k, (_, s) in enumerate(sl):
                    pk = scores[vn][sid == k]
                    if mode == "all":
                        v[k] = auc_fast(pk, s["label"][lv])
                    else:
                        v[k], d_, n_ = dedupe_auc(s, lv, pk, mode)
                        dropped += d_
                        npos += n_
                auc[(vn, mode)] = v
                o = {"auc_mean": round(float(np.nanmean(v)), 4), "auc_median": round(float(np.nanmedian(v)), 4)}
                if mode != "all":
                    o.update(positives=npos, positives_dropped=dropped, dropped_share=round(dropped / npos, 4))
                chk[f"auc_{vn}_{mode}"] = o
        for mode in ("all", "own", "nearest"):
            chk[f"auc_gap_rel_os_minus_raw_{mode}"] = boot(auc[("rel_os", mode)] - auc[("raw_strength", mode)])
        for kk, vv in chk.items():
            if kk.startswith("auc"):
                print("check", lv, kk, json.dumps(vv), flush=True)
        R.setdefault("check", {})[lv] = chk
        keep[lv] = (sl, sid, fold, scores)
        R.setdefault("sweep", {})[lv] = sweep(sl, lv, scores, sid)
    R["mechanism"] = mechanism(ss, keep)
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
