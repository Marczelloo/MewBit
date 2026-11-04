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
# In mewbeat-ma. Train songs only. Songs without the level are skipped.
import sys, json, bisect
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from common import f1_topk, WIN, auc_fast  # noqa: E402
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


def sel_phrase(s, lv, p, seed, greedy=False):
    """greedy: candidates in order of score, a candidate within GREEDY_GAP ms of a pick already made (anywhere in the song) is skipped."""
    spans = phrases_of(s, lv)
    if not spans:
        return None
    t, hm, hidx = s["t"], np.asarray(s["human"][lv], float), s["hidx"][lv]
    sc = p + 1e-7 * np.random.default_rng(seed).random(len(p))
    kept, inh, acc, n_short, short_notes = [], np.zeros(len(hm), bool), [], 0, 0
    for a, b in spans:
        hin = (hm >= a) & (hm < b)
        inh |= hin
        N = int(hin.sum())
        idx = np.where((t >= a) & (t < b))[0]
        order = idx[np.argsort(-sc[idx])]
        if not greedy:
            pick = order[:N]
        else:
            pick = []
            for c in order:
                if len(pick) >= N:
                    break
                j = bisect.bisect_left(acc, t[c])
                if (j < len(acc) and acc[j] - t[c] <= GREEDY_GAP) or (j > 0 and t[c] - acc[j - 1] <= GREEDY_GAP):
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
    return dict(f1=2 * dist / (len(sel) + nh), sel=sel, hum=hm[inh], spans=spans, prec=hit.sum() / ns, rec=dist / nh,
                dup=(hit.sum() - dist) / ns, nph=len(spans), n_short=n_short, short_notes=short_notes, nh=nh)


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
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
