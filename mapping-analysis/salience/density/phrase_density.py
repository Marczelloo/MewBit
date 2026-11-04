# B. What explains the density of a human Normal phrase (R2, song-grouped cross-validation)?
# Thresholds are in REPORT.md (commit a5331c9), fixed before this ran.
#   target : human Normal moments per second in a phrase from analyse() (>= 2 s, inside the first..last human moment).
#   base   : salient sounds per second (candidates above a K quantile, K fitted without the held-out fold) + loudness of the phrase
#            against the song.
#   form 1 : parts of the song from Features v4 only (sections, repeats, position) -> no plugin needed.
#   form 2 : parts of the song from an offline audio structure label (beat-synchronous MFCC+chroma self-similarity,
#            segments, clusters) -> would need the plugin.
#   rule   : a form counts when base+form beats base by >= .02 R2.
# Choices not spelled out in REPORT.md, fixed here before the first run: segments are clustered into max(2, round(k/2)) clusters
# (average linkage, cosine); the quantile is picked on the training groups by the r2 of salient rate against the target.
import os, sys, glob, json, time
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
import multiprocessing as mp
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

QS = (0.5, 0.6, 0.7, 0.8, 0.9)
MIN_PHRASE_MS = 2000
STRUCT = "/cache/struct"
HOPA = 512


# ---------------------------------------------------------------- audio structure (form 2)
def struct_worker(sid):
    out = f"{STRUCT}/{sid}.npz"
    if os.path.exists(out):
        return sid, "cached"
    import librosa
    path = glob.glob(f"{DATA}/audio/{sid}.*")[0]
    ph = json.load(open(f"{PH}/{sid}.json"))
    y, sr = librosa.load(path, sr=22050, mono=True)
    dur_ms = len(y) / sr * 1000
    mf = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOPA)[1:]
    ch = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOPA)
    rms = librosa.amplitude_to_db(librosa.feature.rms(y=y, hop_length=HOPA)[0] + 1e-6)
    tm = ph["timing"]
    b = np.asarray(tm["beats"], float) if tm["snapped"] else np.arange(0, dur_ms, 500.0)
    b = b[(b >= 0) & (b < dur_ms)]
    fr = np.unique(np.round(b / 1000 * sr / HOPA).astype(int))
    fr = fr[(fr > 0) & (fr < mf.shape[1])]
    F = np.vstack([mf, ch, rms[None, : mf.shape[1]]])
    S = librosa.util.sync(F, fr, aggregate=np.mean)
    starts = np.concatenate([[0], fr]) * HOPA / sr * 1000
    np.savez(out, S=S, starts=starts, dur=dur_ms)
    return sid, "ok"


def segment_labels(sid, dur_s, k):
    from librosa.segment import agglomerative
    from sklearn.cluster import AgglomerativeClustering
    z = np.load(f"{STRUCT}/{sid}.npz")
    S, starts = z["S"], z["starts"]
    rms = S[-1]
    D = S[:-1]
    D = (D - D.mean(1, keepdims=True)) / (D.std(1, keepdims=True) + 1e-9)
    period = max(np.median(np.diff(starts)), 50.0)
    w = max(1, int(round(2000 / period)))
    if w > 1:
        from scipy.ndimage import median_filter
        D = median_filter(D, size=(1, w), mode="nearest")
    nb = D.shape[1]
    k = int(max(2, min(k, nb // 2)))
    bnd = np.unique(np.concatenate([[0], agglomerative(D, k)]))
    edges = np.concatenate([bnd, [nb]])
    nseg = len(bnd)
    segmean = np.stack([D[:, edges[i]:edges[i + 1]].mean(1) for i in range(nseg)])
    segrms = np.array([rms[edges[i]:edges[i + 1]].mean() for i in range(nseg)])
    nc = int(min(max(2, round(nseg / 2)), nseg))
    if nseg >= 2 and nc >= 2:
        lab = AgglomerativeClustering(n_clusters=nc, metric="cosine", linkage="average").fit_predict(segmean + 1e-9)
    else:
        lab = np.zeros(nseg, int)
    size = np.array([(lab == lab[i]).sum() for i in range(nseg)])
    seg_t0 = starts[bnd]
    seg_t1 = np.concatenate([starts[bnd[1:]], [float(z["dur"])]])
    rank = (np.argsort(np.argsort(segrms)) + 0.5) / nseg
    dist = np.linalg.norm(segmean, axis=1) / np.sqrt(D.shape[0])
    return dict(t0=seg_t0, t1=seg_t1, size=size, common=(size == size.max()).astype(float), rank=rank, dist=dist)


def form2_feats(sid, dur_s, mids):
    out = {}
    for name, sec in (("15", 15.0), ("30", 30.0)):
        sg = segment_labels(sid, dur_s, int(round(dur_s / sec)))
        i = np.clip(np.searchsorted(sg["t0"], mids, "right") - 1, 0, len(sg["t0"]) - 1)
        pos = np.clip((mids - sg["t0"][i]) / np.maximum(sg["t1"][i] - sg["t0"][i], 1.0), 0, 1)
        out[name] = np.stack([sg["size"][i], sg["common"][i], sg["rank"][i], sg["dist"][i], pos], 1)
    return out


# ---------------------------------------------------------------- phrase table
def energy_arr(s):
    e = s["ph"]["energy"]
    return np.asarray(e["values"] or [0.0], float), (e["hopMs"] if e["hopMs"] > 0 else 500)


def phrase_table(s):
    """Phrases of one song with the target, the loudness, and form-1 columns. None if the song has no usable Normal."""
    hm = s["human"].get("normal")
    if hm is None or len(hm) < 2:
        return None
    lo, hi = hm.min(), hm.max()
    vals, hop = energy_arr(s)
    smean = float(vals.mean()) if vals.mean() > 0 else 1.0
    phs = s["ph"]["phrases"]
    secs = s["ph"]["sections"]
    dur = s["ph"]["durationMs"]
    st = np.array([x["t"] for x in secs], float)
    bounds = np.concatenate([[0.0], st, [float(dur)]])
    sec_energy = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        i0, i1 = int(a // hop), max(int(a // hop) + 1, int(b // hop))
        sec_energy.append(vals[min(i0, len(vals) - 1):max(i1, 1)].mean() if len(vals) else 0.0)
    sec_energy = np.array(sec_energy)
    sec_rank = (np.argsort(np.argsort(sec_energy)) + 0.5) / len(sec_energy)
    rises = np.concatenate([[1.0], [x["rise"] for x in secs]])
    rows = []
    later = {p["repeatOf"] for p in phs if p["isRepeat"]}
    for p in phs:
        a, b = p["startMs"], p["endMs"]
        if b - a < MIN_PHRASE_MS or a < lo or b > hi:
            continue
        mid = (a + b) / 2
        j = int(np.clip(np.searchsorted(bounds, mid, "right") - 1, 0, len(sec_rank) - 1))
        i0, i1 = int(a // hop), max(int(a // hop) + 1, int(b // hop))
        loud = vals[min(i0, len(vals) - 1):max(i1, i0 + 1)].mean()
        secpos = (mid - bounds[j]) / max(bounds[j + 1] - bounds[j], 1.0)
        rows.append(dict(a=a, b=b, mid=mid, y=((hm >= a) & (hm < b)).sum() / ((b - a) / 1000),
                         loud_rel=loud / smean, loud_abs=loud,
                         f1=[sec_rank[j], secpos, mid / dur, float(bool(p["sectionStart"])), float(bool(p["isRepeat"])),
                             float(p["index"] in later), float(np.log(max(rises[j], 1e-3)))]))
    return rows or None


def salient_rate(s, kp, rows, q):
    """candidates above the q-quantile of the song's K ranking, per second, in each phrase."""
    pct = (np.argsort(np.argsort(kp)) + 0.5) / len(kp)
    t = s["t"][pct >= q]
    return np.array([((t >= r["a"]) & (t < r["b"])).sum() / ((r["b"] - r["a"]) / 1000) for r in rows])


def k_scores(ss, fold_s, lv="normal"):
    """K fitted on the songs outside fold f (gen-grid meter, rel_os), applied to every song: out[f][i] = score of song i."""
    names = ss[0]["names"]
    cols = []
    for s in ss:
        gm = gen_meter(s)
        cols.append(rank_cols(np.stack([s["X"][:, names.index("rel_os")]] + [gm[c] for c in K_COLS[1:]], 1)))
    out = {}
    for f in range(NFOLD):
        tr = [i for i, s in enumerate(ss) if lv in s["label"] and fold_s[i] != f]
        m = LogisticRegression(C=1.0, max_iter=400).fit(np.concatenate([cols[i] for i in tr]), np.concatenate([ss[i]["label"][lv] for i in tr]))
        out[f] = [m.predict_proba(c)[:, 1] for c in cols]
    return out


def r2_pooled(y, p):
    return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()


def decomp(y, p, sid):
    """R2 of the song means (between songs) and of the deviations from them (within songs)."""
    ids = np.unique(sid)
    ym = np.array([y[sid == i].mean() for i in ids]); pm = np.array([p[sid == i].mean() for i in ids])
    dy = y - ym[np.searchsorted(ids, sid)]
    dp = p - pm[np.searchsorted(ids, sid)]
    return r2_pooled(ym, pm), 1 - ((dy - dp) ** 2).sum() / (dy ** 2).sum()


def main():
    ss = songs_train()
    n = len(ss)
    print(n, "train songs; test songs not read", flush=True)
    os.makedirs(STRUCT, exist_ok=True)
    t0 = time.time()
    with mp.Pool(8) as pool:
        for sid, msg in pool.imap_unordered(struct_worker, [s["id"] for s in ss]):
            pass
    print("structure features ready", round(time.time() - t0), "s", flush=True)
    fold_s = folds(n)
    kk = k_scores(ss, fold_s)
    # phrase table
    P = []
    skipped = 0
    for i, s in enumerate(ss):
        rows = phrase_table(s)
        if rows is None:
            skipped += 1
            print("skipped (no Normal level or no usable phrase):", s["id"], flush=True)
            continue
        dur_s = s["ph"]["durationMs"] / 1000
        f2 = form2_feats(s["id"], dur_s, np.array([r["mid"] for r in rows]))
        for j, r in enumerate(rows):
            r["song"], r["fold"] = i, int(fold_s[i])
            r["f2_15"], r["f2_30"] = f2["15"][j], f2["30"][j]
            r["sal"] = {q: None for q in QS}
        P.append((i, rows))
    rows_all = [r for _, rs in P for r in rs]
    nph = len(rows_all)
    song = np.array([r["song"] for r in rows_all])
    fold = np.array([r["fold"] for r in rows_all])
    y = np.array([r["y"] for r in rows_all])
    print(f"{len(P)} songs with Normal and phrases, {skipped} skipped, {nph} phrases, mean {y.mean():.3f} moments/s", flush=True)

    loud = np.array([r["loud_rel"] for r in rows_all]); loud_abs = np.array([r["loud_abs"] for r in rows_all])
    F1 = np.array([r["f1"] for r in rows_all]); F2 = {k: np.array([r["f2_" + k] for r in rows_all]) for k in ("15", "30")}
    # salient rate per outer fold f (K fitted without f) and quantile
    sal = {(f, q): np.zeros(nph) for f in range(NFOLD) for q in QS}
    pos = 0
    for i, rs in P:
        idx = np.arange(pos, pos + len(rs)); pos += len(rs)
        for f in range(NFOLD):
            for q in QS:
                sal[(f, q)][idx] = salient_rate(ss[i], kk[f][i], rs, q)

    def design(extra, f, q):
        return np.column_stack([sal[(f, q)], loud] + ([extra] if extra is not None else []))

    models = {"base": None, "base+form1": F1, "base+form2(15s)": F2["15"], "base+form2(30s)": F2["30"],
              "base+form1+form2(15s)": np.hstack([F1, F2["15"]]), "base+form1+form2(30s)": np.hstack([F1, F2["30"]]),
              "form1 only": "only1", "base+abs loudness (info)": loud_abs[:, None]}
    oof = {k: np.zeros(nph) for k in models}
    chosen_q = {}
    for f in range(NFOLD):
        tr, te = fold != f, fold == f
        best = max(QS, key=lambda q: np.corrcoef(sal[(f, q)][tr], y[tr])[0, 1] ** 2)
        chosen_q[f] = best
        for name, ex in models.items():
            if isinstance(ex, str):
                X = F1
            else:
                X = design(ex, f, best)
            sc = StandardScaler().fit(X[tr])
            oof[name][te] = Ridge(alpha=1.0).fit(sc.transform(X[tr]), y[tr]).predict(sc.transform(X[te]))
    print("quantile chosen per fold:", chosen_q, flush=True)

    res = {}
    rng = np.random.default_rng(7)
    songs_u = np.unique(song)
    for name in models:
        r2 = r2_pooled(y, oof[name]); bw = decomp(y, oof[name], song)
        res[name] = dict(r2=round(float(r2), 4), r2_between=round(float(bw[0]), 4), r2_within=round(float(bw[1]), 4))
    for name in models:
        if name in ("base", "form1 only"):
            continue
        d = res[name]["r2"] - res["base"]["r2"]
        bs = []
        for _ in range(2000):
            pick = rng.choice(songs_u, len(songs_u))
            m = np.concatenate([np.where(song == u)[0] for u in pick])
            bs.append(r2_pooled(y[m], oof[name][m]) - r2_pooled(y[m], oof["base"][m]))
        res[name]["delta_vs_base"] = round(float(d), 4)
        res[name]["delta_ci95"] = [round(float(np.quantile(bs, .025)), 4), round(float(np.quantile(bs, .975)), 4)]
        res[name]["pass_.02"] = bool(d >= 0.02 - 1e-12)
    for k, v in res.items():
        print(k, v, flush=True)

    # human between-song distribution
    dens, lou = [], []
    for i, rs in P:
        yy = np.array([r["y"] for r in rs]); w = np.array([r["b"] - r["a"] for r in rs])
        dens.append(float((yy * w).sum() / w.sum()))
        vals, _ = energy_arr(ss[i]); lou.append(float(vals.mean()))
    dens = np.array(dens); lou = np.array(lou)
    dist = dict(songs=len(dens), median=round(float(np.median(dens)), 3), mean=round(float(dens.mean()), 3),
                cv=round(float(dens.std() / dens.mean()), 3), corr_with_song_loudness=round(float(np.corrcoef(dens, lou)[0, 1]), 3),
                p10=round(float(np.quantile(dens, .1)), 3), p90=round(float(np.quantile(dens, .9)), 3))
    pm = np.array([oof["base+form1"][song == i].mean() for i, _ in P])
    dist["model_base+form1_song_cv"] = round(float(pm.std() / pm.mean()), 3)
    print("human song density", dist, flush=True)
    phr = dict(phrases=nph, mean_phrase_s=round(float(np.mean([r["b"] - r["a"] for r in rows_all]) / 1000), 2),
               target_cv_within_song=round(float(np.mean([y[song == i].std() / max(y[song == i].mean(), 1e-9) for i, _ in P])), 3))
    print("phrases", phr, flush=True)
    json.dump(dict(res=res, dist=dist, phr=phr, skipped=skipped, q=chosen_q), open("/cache/phrase_density.json", "w"), indent=1)


if __name__ == "__main__":
    main()
