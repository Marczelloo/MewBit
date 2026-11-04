"""Per-song candidate moments + salience signals. Usage:
   python3 extract.py [--limit N] [--ids a,b] [--jobs 14]  -> /scripts/feat/<id>.pkl
   python3 extract.py --hd                                 -> /scripts/feat/hd.pkl
"""
import os, sys, json, time, glob, pickle, argparse
for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[k] = "1"
import numpy as np
import scipy.ndimage as ndi
import librosa

DATA = "/repo/.mewbeat-debug/data"
OUT = "/scripts/feat"
SR, NFFT, HOP = 22050, 2048, 256
FMS = 1000.0 * HOP / SR  # ms per frame (11.61)
BANDS = {"low": (0, 200), "lowmid": (200, 800), "highmid": (800, 3000), "high": (3000, 1e9)}
TEST = set("310607 363594 563569 636959 808872 859248 923488 1000722 1277503 1329723 1570640 1697477 1773164 1784295 1894317 2200258 2224035 2270163 2314654 2515207".split())


def flux_bins(L):
    """SuperFlux-like half-wave flux per bin: current frame vs freq-max-filtered previous frame."""
    ref = ndi.maximum_filter1d(L, size=3, axis=0)
    D = np.zeros_like(L)
    D[:, 1:] = np.maximum(0.0, L[:, 1:] - ref[:, :-1])
    return D


def band_sums(D, freqs):
    out = {}
    for b, (lo, hi) in BANDS.items():
        m = (freqs >= lo) & (freqs < hi)
        out[b] = D[m].sum(0)
    m = (freqs >= 200) & (freqs < 3000)
    out["mid"] = D[m].sum(0)
    out["all"] = D.sum(0)
    return out


def shift_t(M, k):
    """M[:, t+k] with edge clamping."""
    T = M.shape[-1]
    idx = np.clip(np.arange(T) + k, 0, T - 1)
    return M[..., idx]


def compute_series(path):
    tm = {}
    t0 = time.time()
    y, _ = librosa.load(path, sr=SR, mono=True)
    y = y / (np.abs(y).max() + 1e-9)
    dur = len(y) / SR
    tm["load"] = time.time() - t0

    t0 = time.time()
    Sc = librosa.stft(y, n_fft=NFFT, hop_length=HOP)
    S = np.abs(Sc).astype(np.float32)
    del Sc
    T = S.shape[1]
    freqs = librosa.fft_frequencies(sr=SR, n_fft=NFFT)
    tm["stft"] = time.time() - t0

    t0 = time.time()
    LS = np.log1p(10 * S)
    ser = {}
    fb = band_sums(flux_bins(LS), freqs)
    for b, v in fb.items():
        ser[f"flux_full_{b}"] = v
    tm["flux_full"] = time.time() - t0

    t0 = time.time()
    ser["os_broad"] = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)[:T]
    tm["os_mel"] = time.time() - t0

    t0 = time.time()
    H, P = librosa.decompose.hpss(S, kernel_size=31, margin=1.0, power=2.0)
    H = H.astype(np.float32); P = P.astype(np.float32)
    tm["hpss"] = time.time() - t0

    t0 = time.time()
    for nm, X in (("H", H), ("P", P)):
        fb = band_sums(flux_bins(np.log1p(10 * X)), freqs)
        for b, v in fb.items():
            ser[f"flux_{nm}_{b}"] = v
    tm["flux_hp"] = time.time() - t0

    # distinctiveness: band energy (amplitude) vs 2 s local mean
    t0 = time.time()
    W = int(round(2000 / FMS))
    def energy(X, lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return np.sqrt((X[m].astype(np.float64) ** 2).sum(0))
    def dist(E):
        return np.log((E + 1e-6) / (ndi.uniform_filter1d(E, W, mode="nearest") + 1e-6))
    for b, (lo, hi) in BANDS.items():
        ser[f"dist_{b}"] = dist(energy(S, lo, hi))
    ser["dist_Hmid"] = dist(energy(H, 200, 3000))
    ser["dist_Pall"] = dist(energy(P, 0, 1e9))
    ser["rel_os"] = ser["os_broad"] / (ndi.uniform_filter1d(ser["os_broad"], W, mode="nearest") + 1e-6)
    ser["rel_fluxHmid"] = ser["flux_H_mid"] / (ndi.uniform_filter1d(ser["flux_H_mid"], W, mode="nearest") + 1e-6)
    tm["dist"] = time.time() - t0

    # chroma change on harmonic part
    t0 = time.time()
    ch = librosa.feature.chroma_stft(S=(H ** 2), sr=SR, n_fft=NFFT, tuning=0.0, norm=None)
    ch = ch / (np.linalg.norm(ch, axis=0, keepdims=True) + 1e-9)
    Mc = ndi.uniform_filter1d(ch, 24, axis=1, mode="nearest")
    a = shift_t(Mc, 14); b = shift_t(Mc, -14)
    a = a / (np.linalg.norm(a, axis=0, keepdims=True) + 1e-9)
    b = b / (np.linalg.norm(b, axis=0, keepdims=True) + 1e-9)
    ser["chroma_change"] = 1.0 - (a * b).sum(0)
    tm["chroma"] = time.time() - t0

    # CQT based top voice 250-2500 Hz
    t0 = time.time()
    C = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=librosa.note_to_hz("B3"), n_bins=80, bins_per_octave=24)).astype(np.float32)
    if C.shape[1] < T:
        C = np.pad(C, ((0, 0), (0, T - C.shape[1])), mode="edge")
    C = C[:, :T]
    tm["cqt"] = time.time() - t0
    t0 = time.time()
    Hm = ndi.median_filter(C, size=(1, 17), mode="nearest")
    Pm = ndi.median_filter(C, size=(17, 1), mode="nearest")
    Hc = C * (Hm ** 2 / (Hm ** 2 + Pm ** 2 + 1e-12))
    M = ndi.uniform_filter1d(Hc, 11, axis=1, mode="nearest")
    before = shift_t(M, -8); after = shift_t(M, 8)
    pb = before.argmax(0); pa = after.argmax(0)
    ser["tv_jump"] = np.minimum(np.abs(pa - pb), 24) / 24.0
    ser["tv_new"] = (np.abs(pa - pb) >= 2).astype(np.float32)
    asum = after.sum(0) + 1e-9
    apk = after.max(0)
    ser["tv_strength"] = apk / asum
    ar = np.arange(T)
    ser["tv_rise"] = np.clip((apk - before[pa, ar]) / (apk + 1e-9), 0, 1)
    ser["hcqt_flux"] = np.maximum(0, after - before).sum(0)
    tm["tv"] = time.time() - t0
    return {k: v.astype(np.float32) for k, v in ser.items()}, dur, tm


def candidates(f):
    ev = []  # (t, s, source)
    for b in f["bands"]:
        for o in b["onsets"]:
            ev.append((o["t"], o["s"], b["name"]))
    for o in f["drums"]:
        ev.append((o["t"], o["s"], "drums"))
    for o in f["bass"]:
        ev.append((o["t"], o["s"], "bass"))
    for o in f["lead"]:
        ev.append((o["t"], o["s"], "lead"))
    ev.sort(key=lambda e: e[0])
    sources = ["low", "lowmid", "highmid", "high", "drums", "bass", "lead"]
    cl = []
    cur = None
    for t, s, src in ev:
        if cur is None or t - cur["a"] > 30:
            cur = {"a": t, "m": []}
            cl.append(cur)
        cur["m"].append((t, s, src))
    ts = np.zeros(len(cl)); P = np.zeros((len(cl), len(sources)), np.float32)
    for i, c in enumerate(cl):
        best = max(c["m"], key=lambda e: e[1])
        ts[i] = best[0]
        for t, s, src in c["m"]:
            j = sources.index(src)
            P[i, j] = max(P[i, j], s)
    return ts, P, ["p_" + s for s in sources]


def meter(ts, beats, downbeats, conf):
    beats = np.asarray(beats, float)
    n = len(ts)
    out = {k: np.zeros(n, np.float32) for k in ("m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_beat", "d_grid")}
    if len(beats) < 3:
        out["m_other"][:] = 1
        return out
    i = np.clip(np.searchsorted(beats, ts, side="right") - 1, 0, len(beats) - 2)
    per = beats[i + 1] - beats[i]
    u = (ts - beats[i]) / per
    u = u - np.floor(u)
    db = np.minimum(u, 1 - u)
    dh = np.abs(u - 0.5)
    dq = np.minimum(np.abs(u - 0.25), np.abs(u - 0.75))
    tol = 0.07
    mb = db < tol; mh = (dh < tol) & ~mb; mq = (dq < tol) & ~mb & ~mh
    out["m_beat"][:] = mb; out["m_half"][:] = mh; out["m_quarter"][:] = mq
    out["m_other"][:] = ~(mb | mh | mq)
    dbs = np.asarray(downbeats, float)
    if len(dbs):
        nb = np.where(u < 0.5, beats[i], beats[i + 1])
        isd = np.abs(nb[:, None] - dbs[None, :]).min(1) < 2
        out["m_down"][:] = mb & isd
    out["d_beat"][:] = db
    out["d_grid"][:] = np.minimum(db, np.minimum(dh, dq))
    return out


def lookup(ser_f, tms, shift, size):
    fr = np.clip(np.round((np.asarray(tms) + shift) / FMS).astype(int), 0, len(ser_f) - 1)
    return ser_f[fr]


def build(path, f, human=None, want_timing=True):
    ser, dur, tm = compute_series(path)
    ts, P, pn = candidates(f)
    T = len(ser["os_broad"])
    # per-family lag between my frames and plugin times (audio-only: maximise z-scored reference series at plugin candidates)
    def fam_of(k):
        if k in ("os_broad", "rel_os"): return "mel"
        if k.startswith("flux_") or k == "rel_fluxHmid": return "flux"
        if k.startswith("dist_"): return "dist"
        if k == "chroma_change": return "chroma"
        return "cqt"
    def zs(v): return (v - v.mean()) / (v.std() + 1e-9)
    refs = {"mel": zs(ser["os_broad"]), "flux": zs(ser["flux_full_all"]), "chroma": zs(ser["chroma_change"]), "cqt": zs(ser["hcqt_flux"]),
            "dist": sum(zs(ser[f"dist_{b}"]) for b in BANDS)}
    base = np.round(ts / FMS).astype(int)
    lags = list(range(-8, 9))
    famshift = {}
    for fam, r in refs.items():
        sc = [r[np.clip(base + L, 0, T - 1)].mean() for L in lags]
        famshift[fam] = lags[int(np.argmax(sc))] * FMS
    famshift["chroma"] = famshift["flux"]; famshift["cqt"] = famshift["flux"]  # weak references are too noisy per song
    shiftd = {k: famshift[fam_of(k)] for k in ser}
    shift = famshift
    mf5 = {k: ndi.maximum_filter1d(v, 5) for k, v in ser.items()}
    mf7 = {k: ndi.maximum_filter1d(v, 7) for k, v in ser.items()}
    names = list(ser.keys())
    cols = {}
    for k in names:
        cols[k] = lookup(mf5[k], ts, shiftd[k], 5)
    # plugin
    for j, n in enumerate(pn):
        cols[n] = P[:, j]
    cols["p_n"] = (P > 0).sum(1).astype(np.float32)
    cols["p_max"] = P.max(1)
    # meter
    tp = f["tempo"]
    mt = meter(ts, tp.get("beats", []), tp.get("downbeats", []), tp.get("confidence", 0))
    cols.update(mt)
    # repeat consensus
    phr = f["phrases"]["list"]
    starts = np.array([p["startMs"] for p in phr]); ends = np.array([p["endMs"] for p in phr])
    pid = np.clip(np.searchsorted(starts, ts, side="right") - 1, 0, len(phr) - 1)
    partners = [[] for _ in ts]  # list of time offsets
    for idx in range(len(ts)):
        p = phr[pid[idx]]
        if p["repeatOf"] is not None:
            partners[idx].append(-p["lagMs"])
        for r, q in enumerate(phr):
            if q["repeatOf"] == pid[idx]:
                partners[idx].append(q["lagMs"])
    has_rep = np.array([len(p) > 0 for p in partners], np.float32)
    cols["has_repeat"] = has_rep
    for k in names:
        acc = cols[k].astype(np.float64).copy(); cnt = np.ones(len(ts))
        for idx in np.where(has_rep > 0)[0]:
            for off in partners[idx]:
                tt = ts[idx] + off
                if 0 <= tt < dur * 1000:
                    acc[idx] += lookup(mf7[k], [tt], shiftd[k], 7)[0]; cnt[idx] += 1
        cols["rc_" + k] = (acc / cnt).astype(np.float32)
    fn = list(cols.keys())
    X = np.stack([cols[k] for k in fn], 1).astype(np.float32)
    res = {"X": X, "names": fn, "t": ts, "dur": dur, "shift_ms": shift, "timing": tm, "conf": tp.get("confidence", 0),
           "bpm": tp.get("bpm", 0), "phr": [(p["startMs"], p["endMs"], p["repeatOf"], p["lagMs"]) for p in phr]}
    if human is not None:
        res["human"] = {}
        res["label"] = {}
        res["offset"] = {}
        for lv, h in human.items():
            hm = np.array(sorted(set(x[0] for x in h)), float)
            res["human"][lv] = hm
            if len(hm) == 0:
                continue
            j = np.clip(np.searchsorted(hm, ts), 1, len(hm) - 1)
            d = np.minimum(np.abs(ts - hm[j - 1]), np.abs(ts - hm[j]))
            res["label"][lv] = (d <= 35).astype(np.int8)
            # signed offset human - candidate for matched humans
            jj = np.clip(np.searchsorted(ts, hm), 1, len(ts) - 1)
            dd = np.where(np.abs(hm - ts[jj - 1]) < np.abs(hm - ts[jj]), hm - ts[jj - 1], hm - ts[jj])
            res["offset"][lv] = dd[np.abs(dd) <= 35]
    res["series_for_hd"] = None
    return res


def do_song(sid):
    out = f"{OUT}/{sid}.pkl"
    if os.path.exists(out):
        return sid, "skip"
    try:
        f = json.load(open(f"{DATA}/features/{sid}.json"))
        human = {}
        for lv in ("easy", "normal", "hard"):
            p = f"{DATA}/human/{lv}/{sid}.json"
            if os.path.exists(p):
                human[lv] = json.load(open(p))
        t0 = time.time()
        r = build(glob.glob(f"{DATA}/audio/{sid}.*")[0], f, human)
        r["total_s"] = time.time() - t0
        pickle.dump(r, open(out, "wb"))
        return sid, f"ok {r['total_s']:.1f}s dur {r['dur']:.0f}s cand {len(r['t'])} shift { {k: round(v) for k, v in r["shift_ms"].items()} }"
    except Exception as e:
        import traceback
        return sid, "ERR " + traceback.format_exc()[-600:]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--ids", default="")
    ap.add_argument("--jobs", type=int, default=14)
    ap.add_argument("--hd", action="store_true")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if a.hd:
        j = json.load(open("/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.json"))
        t0 = time.time()
        r = build("/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.pcm.wav", j["features"], None)
        r["total_s"] = time.time() - t0
        pickle.dump(r, open(f"{OUT}/hd.pkl", "wb"))
        print("hd ok", r["total_s"], r["dur"], len(r["t"]), r["shift_ms"], r["timing"])
        sys.exit(0)
    ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{DATA}/features/*.json"))
    ids = [i for i in ids if i not in TEST]
    if a.ids:
        ids = a.ids.split(",")
    if a.limit:
        ids = ids[:a.limit]
    import multiprocessing as mp
    with mp.Pool(a.jobs) as pool:
        for sid, msg in pool.imap_unordered(do_song, ids):
            print(sid, msg, flush=True)
