# POST-HOC proxy test (fix round 3). Chosen AFTER rel_proxy_select.log showed that rel_os without its 5-frame max filter falls to the AUC of
# raw_strength (.866/.869/.852 against .871/.868/.846). Nothing here changes the thresholds or decision A of REPORT.md (commit a5331c9, fixed
# before any run); this only asks: does a max-filtered Features v4 strength clear the committed threshold, which no proxy of rel_proxy.log tried?
# Proxies (dcommon.mf_proxies; half-width +-2 frames = +-23.22 ms, frame = 1000 * 256 / 22050 = 11.61 ms, as the rel_os filter):
#   W_mf      max of raw_strength over all candidates within +-23.22 ms.
#   W_mf_rel  W_mf / mean of W_mf over the candidates within +-1 s (the 2 s window of rel_os).
#   W_rel_mf  max over +-23.22 ms of raw_strength / (mean of raw_strength within +-1 s), i.e. in the order of rel_os (divide, then filter).
# Three proxies were tried, all reported, none dropped. Same 80 train songs, candidates, generator-grid meter and folds as rel_proxy.py.
# K and the AUC rule are those of rel_proxy.py (rank percentiles, LogisticRegression C=1 max_iter 400, per-song AUC, mean and median); the
# committed pass rule: proxy minus rel_os >= -.01 on the mean and on the median AUC at each of E/N/H. rel_os and raw_strength are recomputed
# here as references and must give the values of rel_proxy.log / rel_proxy_select.log.
# Selection (phrase budget = oracle: N = human notes in the phrase; plain = top-N; real = greedy with the generator's minNoteGapMs
# 130/100/60; snap_real = candidates first moved to the generator grid, as in rel_proxy_select.sweep): F1 median of each, paired median of
# R (rel_os) minus the proxy with a bootstrap 95% CI, duplicate share, share of the grid beats kept (beat gap to the human: |beats kept - human
# beats kept|, paired R minus proxy), and the notes the greedy could not place. Song and window budgets (plain) as in rel_proxy_select.py.
# Share of the R minus W gap closed = (proxy - W) / (R - W) on paired medians (F1) or on means (AUC).
# In mewbeat-ma. Train songs only.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from common import auc_fast  # noqa: E402
from rel_proxy import proxies  # noqa: E402
from rel_proxy_select import (sel_song, sel_window, sel_phrase, snap_cands, collapse, REAL_GAP, beats_in, beats_arr, boot,  # noqa: E402
                              pair_stats, nearest_human)

OUT = "/cache/rel_proxy_mf.json"
PROX = ("W_mf", "W_mf_rel", "W_rel_mf")
ALL = ("rel_os", "raw_strength") + PROX
THR = -0.01


def col(s, names, vn):
    return s["X"][:, names.index("rel_os")] if vn == "rel_os" else s["px"][vn]


def closes(p, w, r):
    return round(float((p - w) / (r - w)), 3) if abs(r - w) > 1e-12 else None


def main():
    ss = songs_train()
    n = len(ss)
    print("POST-HOC proxy test (fix round 3); thresholds and decision A unchanged;", n, "train songs; test songs not read", flush=True)
    print(f"max filter half-width {MF_HALF_MS:.4f} ms = 2 frames of {1000.0 * 256 / 22050:.4f} ms; mean window +-{MF_REL_HALF_MS:.0f} ms", flush=True)
    fold_s = folds(n)
    names = ss[0]["names"]
    for s in ss:
        s["gm"] = gen_meter(s)
        s["px"] = proxies(s)
        s["px"].update(mf_proxies(s))
    R = {"posthoc": True, "songs": n, "auc": {}, "pairs": {}, "select": {}}
    R["pairs"] = pair_stats(ss, {"rel_os": lambda s: s["X"][:, names.index("rel_os")], **{vn: (lambda s, vn=vn: s["px"][vn]) for vn in ("raw_strength",) + PROX}})
    for lv in LV:
        sl = [(i, s) for i, s in enumerate(ss) if lv in s["label"]]
        m_ = len(sl)
        y = np.concatenate([s["label"][lv] for _, s in sl])
        sid = np.concatenate([np.full(len(s["t"]), k) for k, (_, s) in enumerate(sl)])
        fold = np.array([fold_s[i] for i, _ in sl])[sid]
        scores, auc = {}, {}
        for vn in ALL:
            X = np.concatenate([rank_cols(np.stack([col(s, names, vn)] + [s["gm"][c] for c in K_COLS[1:]], 1)) for _, s in sl])
            scores[vn] = lr_oof(X, y, fold)
            a = per_song_auc(scores[vn], sid, y, m_)
            auc[vn] = a
        ref = {vn: (float(np.nanmean(auc[vn])), float(np.nanmedian(auc[vn]))) for vn in ALL}
        o = {}
        for vn in ALL:
            mean, med = ref[vn]
            row = {"mean": round(mean, 4), "median": round(med, 4)}
            if vn != "rel_os":
                dm, dd = mean - ref["rel_os"][0], med - ref["rel_os"][1]
                row.update(diff_mean=round(dm, 4), diff_median=round(dd, 4), pass_mean=bool(dm >= THR - 1e-12), pass_median=bool(dd >= THR - 1e-12),
                           paired_per_song_diff=boot(auc[vn] - auc["rel_os"]))
            if vn in PROX:
                row["share_of_R_minus_W_auc_gap_closed_mean"] = closes(mean, ref["raw_strength"][0], ref["rel_os"][0])
                row["share_of_R_minus_W_auc_gap_closed_median"] = closes(med, ref["raw_strength"][1], ref["rel_os"][1])
            o[vn] = row
            print("auc", lv, vn, json.dumps(row), flush=True)
        R["auc"][lv] = o
        # ---- selection
        sel = {}
        snapc = [(snap_cands(s, lv),) for _, s in sl]
        snapc = [(tt, nearest_human(tt, np.asarray(s["human"][lv], float))) for (tt,), (_, s) in zip(snapc, sl)]
        rows = [("song", "plain"), ("window", "plain"), ("phrase", "g0"), ("phrase", "real"), ("phrase", "snap_real")]
        for bud, mode in rows:
            res, hb = {}, np.full(m_, np.nan)
            for vn in ALL:
                c = {q: np.full(m_, np.nan) for q in ("f1", "bk", "dup", "short", "nh")}
                rng = np.random.default_rng(0)
                for k, (_, s) in enumerate(sl):
                    p = scores[vn][sid == k]
                    times = s["t"]
                    if bud == "song":
                        r = sel_song(s, lv, p, rng)
                    elif bud == "window":
                        r = sel_window(s, lv, p, k)
                    elif mode == "g0":
                        r = sel_phrase(s, lv, p, k)
                    elif mode == "real":
                        r = sel_phrase(s, lv, p, k, greedy=True, gap=REAL_GAP[lv])
                    else:
                        tt, hh = snapc[k]
                        times = tt
                        r = sel_phrase(s, lv, p, k, greedy=True, gap=REAL_GAP[lv], tt=tt, hh=hh, alive=collapse(tt, p))
                    if r is None:
                        continue
                    c["f1"][k] = r["f1"]
                    if bud == "phrase":
                        c["dup"][k], c["short"][k], c["nh"][k] = r["dup"], r["short_notes"], r["nh"]
                    if s["ph"]["timing"]["snapped"]:
                        b = beats_in(s, r["spans"])
                        c["bk"][k] = beats_arr(b, times[r["sel"]])
                        if vn == "rel_os":
                            hb[k] = beats_arr(b, r["hum"])
                res[vn] = c
            out = {}
            gap = lambda c: np.abs(c["bk"] - hb)
            a_ = res["rel_os"]
            for vn in ALL:
                c = res[vn]
                row = {"f1_median": round(float(np.nanmedian(c["f1"])), 4), "beat_gap_mean": round(float(np.nanmean(gap(c))), 4)}
                if bud == "phrase":
                    row.update(duplicate_share_mean=round(float(np.nanmean(c["dup"])), 4), notes_short=int(np.nansum(c["short"])),
                               human_notes=int(np.nansum(c["nh"])))
                if vn != "rel_os":
                    row["paired_rel_os_minus_proxy_f1"] = boot(a_["f1"] - c["f1"])
                    row["paired_rel_os_minus_proxy_beat_gap"] = boot(gap(a_) - gap(c))
                out[vn] = row
            for vn in PROX:
                d_r = np.nanmedian(a_["f1"] - res["raw_strength"]["f1"])
                d_p = np.nanmedian(res[vn]["f1"] - res["raw_strength"]["f1"])
                out[vn]["share_of_R_minus_W_f1_gap_closed_paired_median"] = closes(d_p, 0.0, d_r)
            out["paired_rel_os_minus_raw_strength_f1"] = boot(a_["f1"] - res["raw_strength"]["f1"])
            out["human_beat_share_mean"] = round(float(np.nanmean(hb)), 4)
            sel[f"{bud}/{mode}"] = out
            for vn in ALL:
                print("select", lv, bud, mode, vn, json.dumps(out[vn]), flush=True)
            print("select", lv, bud, mode, "rel_os_minus_raw_strength", json.dumps(out["paired_rel_os_minus_raw_strength_f1"]), flush=True)
        R["select"][lv] = sel
    for vn in PROX:
        ok = all(R["auc"][lv][vn]["pass_mean"] and R["auc"][lv][vn]["pass_median"] for lv in LV)
        R.setdefault("clears_threshold", {})[vn] = bool(ok)
        print("clears the committed -.01 threshold (mean and median, E/N/H):", vn, ok, flush=True)
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
