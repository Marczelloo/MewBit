# A. Can a proxy built from Features v4 onset strengths replace rel_os (librosa mel onset strength / its 2 s mean) in K?
# Thresholds are in REPORT.md (commit a5331c9), fixed before this ran.
# K = logistic regression (C=1) on within-song rank percentiles of rel_os (or the proxy), m_beat, m_half, m_quarter,
# m_other, m_down, d_grid. 5-fold CV grouped by song. AUC per song; mean and median over songs.
# rel_os in the pkl: librosa.onset.onset_strength, divided by its 2 s uniform mean, max-filtered over 5 frames and sampled at
# the candidate time plus the per-song mel shift (extract.py build()). Candidates are the Features v4 30 ms clusters.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403

OUT = "/cache/rel_proxy.json"
SRC = ["low", "lowmid", "highmid", "high", "drums", "bass", "lead"]


def win_idx(ts, w):
    return np.searchsorted(ts, ts - w, "left"), np.searchsorted(ts, ts + w, "right")


def win_mean(v, ts, w):
    lo, hi = win_idx(ts, w)
    cs = np.concatenate([[0.0], np.cumsum(v, dtype=np.float64)])
    return (cs[hi] - cs[lo]) / (hi - lo), cs[hi] - cs[lo]


def win_max(v, ts, w):
    lo, hi = win_idx(ts, w)
    return np.array([v[a:b].max() for a, b in zip(lo, hi)])


def energy_rel(f, ts, w):
    e = f.get("energy") or {}
    vals = np.asarray(e.get("values") or [0.0], float)
    hop = e.get("hopMs") if (e.get("hopMs") or 0) > 0 else 500
    at = lambda t: vals[np.clip(np.floor(np.asarray(t) / hop).astype(int), 0, len(vals) - 1)]
    cs = np.concatenate([[0.0], np.cumsum(vals)])
    a = np.clip(np.floor((ts - w) / hop).astype(int), 0, len(vals) - 1)
    b = np.clip(np.floor((ts + w) / hop).astype(int), 0, len(vals) - 1)
    mean = (cs[b + 1] - cs[a]) / (b - a + 1)
    return at(ts) / (mean + 1e-6)


def proxies(s):
    ts, P, f = s["t"], s["P"], s["f"]
    ps, tot = P.max(1), P.sum(1)
    out = {}
    for w, nm in ((500, "0.5"), (1000, "1"), (2000, "2")):
        m, _ = win_mean(ps, ts, w)
        out[f"cluster/mean+-{nm}s"] = ps / (m + 1e-9)
    _, sm = win_mean(ps, ts, 1000)
    out["cluster/sum+-1s"] = ps / (sm + 1e-9)
    out["cluster/max+-1s"] = ps / (win_max(ps, ts, 1000) + 1e-9)
    m, _ = win_mean(tot, ts, 1000)
    out["sources_sum/mean+-1s"] = tot / (m + 1e-9)
    best = np.zeros(len(ts))
    for j in range(P.shape[1]):
        c = P[:, j]
        num = win_mean(c, ts, 1000)[1]
        den = win_mean((c > 0).astype(float), ts, 1000)[1]
        r = np.where(c > 0, c / (num / np.maximum(den, 1) + 1e-9), 0.0)
        best = np.maximum(best, r)
    out["per_source_max_rel+-1s"] = best
    out["raw_strength"] = ps
    out["energy/mean+-1s"] = energy_rel(f, ts, 1000)
    return out


def main():
    ss = songs_train()
    n = len(ss)
    print(n, "train songs; test songs not read", flush=True)
    fold_s = folds(n)
    names = ss[0]["names"]
    ki = [names.index(c) for c in K_COLS]
    pk_meter_equal = 0
    no_grid = 0
    for s in ss:
        gm = gen_meter(s)
        s["gm"] = gm
        s["px"] = proxies(s)
        pm = s["X"][:, [names.index(c) for c in K_COLS[1:]]]
        pk_meter_equal += int(np.allclose(pm, np.stack([gm[c] for c in K_COLS[1:]], 1)))
        no_grid += int(not s["ph"]["timing"]["snapped"])
    print(f"meter pkl (raw tracker beats) == meter on generator grid in {pk_meter_equal} of {n} songs; "
          f"{no_grid} songs have no generator grid (all m_other, d_grid 0)", flush=True)
    pnames = list(ss[0]["px"].keys())
    R = {"songs": n, "meter_equal": pk_meter_equal, "no_grid": no_grid, "levels": {}}
    for lv in LV:
        sl = [(i, s) for i, s in enumerate(ss) if lv in s["label"]]
        skipped = n - len(sl)
        y = np.concatenate([s["label"][lv] for _, s in sl])
        sid = np.concatenate([np.full(len(s["t"]), k) for k, (_, s) in enumerate(sl)])
        fold = np.array([fold_s[i] for i, _ in sl])[sid]
        res = {}

        def run(label, colfn, grid):
            cols = []
            for _, s in sl:
                m = s["gm"] if grid == "gen" else {c: s["X"][:, names.index(c)] for c in K_COLS[1:]}
                cols.append(np.stack([colfn(s)] + [m[c] for c in K_COLS[1:]], 1))
            X = np.concatenate([rank_cols(c) for c in cols])  # within-song ranks
            p = lr_oof(X, y, fold)
            a = per_song_auc(p, sid, y, len(sl))
            res[f"{label}|{grid}"] = {"mean": round(float(np.nanmean(a)), 4), "median": round(float(np.nanmedian(a)), 4)}
            print(lv, label, grid, res[f"{label}|{grid}"], flush=True)
            return a

        for grid in ("gen", "pkl"):
            run("rel_os", lambda s: s["X"][:, names.index("rel_os")], grid)
            run("no_strength_col", lambda s: np.zeros(len(s["t"])), grid)
            for pn in pnames:
                run(pn, lambda s, pn=pn: s["px"][pn], grid)
        R["levels"][lv] = {"songs": len(sl), "skipped_without_level": skipped, "auc": res}
    # decision on the generator grid
    def mean3(label, kind):
        return float(np.mean([R["levels"][lv]["auc"][f"{label}|gen"][kind] for lv in LV]))
    ranked = sorted(pnames, key=lambda p: -mean3(p, "mean"))
    chosen = ranked[0]
    dec = {"chosen": chosen, "ranking_by_mean_auc_over_levels": [(p, round(mean3(p, "mean"), 4)) for p in ranked], "per_level": {}}
    ok = True
    for lv in LV:
        a = R["levels"][lv]["auc"]
        row = {}
        for kind in ("mean", "median"):
            d = a[f"{chosen}|gen"][kind] - a["rel_os|gen"][kind]
            row[kind] = {"proxy": a[f"{chosen}|gen"][kind], "rel_os": a["rel_os|gen"][kind], "diff": round(d, 4), "pass": bool(d >= -0.01 - 1e-12)}
            ok &= row[kind]["pass"]
        dec["per_level"][lv] = row
    dec["rel_os_not_needed"] = bool(ok)
    R["decision"] = dec
    print(json.dumps(dec, indent=1), flush=True)
    json.dump(R, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
