# C. Does a cheap detector of sustained sounds beat the current one? Three candidates:
#   D1  a longer HPSS window (harmonic median filter ~1.4 s on a spectrogram averaged over 4 frames)
#   D2  chroma stability that tolerates vibrato (36 bins, best match over +-2 bins)
#   D3  the centre channel. REPORT.md says "mid = (L+R)/2"; that is exactly the mono mix every feature already uses, so read
#       literally D3 would be D1 again. Both are measured: D3 = centre extraction (mid with the side removed by a mask),
#       and D1 itself stands for the literal reading.
# Thresholds are in REPORT.md (commit a5331c9). Choices REPORT.md leaves open, fixed here before the first run:
#   - D2 sounds = runs of frames whose tolerant chroma similarity to the frame 4 steps later is >= .9 (>= 200 ms, one-frame gaps closed);
#   - coverage is the detector's own segments (>= 1 beat), not their union with the current detectors (unions are reported as info);
#   - cost = the detector's extra seconds per audio minute, one thread, STFT not counted; the chain every set shares (contour,
#     onset peaks, segments, chroma, flux of the current mix detector) is reported separately and with it;
#   - the 30 per minute guard keeps the most confident segments (mean contour confidence; D2 mean similarity).
# In mewbeat-ma: /repo ro, /scripts = salience dir with feat/, /out = .mewbeat-debug, /cache = scratch. Train songs only.
import os, sys, glob, json, pickle, time, importlib.util
for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[k] = "1"
import numpy as np
import scipy.ndimage as ndi
import librosa
from scipy.stats import rankdata
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
sys.path.insert(0, "/repo/mapping-analysis/salience/listening")
sys.path.insert(1, "/repo/mapping-analysis/salience/holds")
from common import auc_fast, LV  # noqa: E402
import measure as M  # noqa: E402  (holds/measure.py: the baseline measurement)
_spec = importlib.util.spec_from_file_location("hextract", "/repo/mapping-analysis/salience/holds/extract.py")
HX = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(HX)
_sp2 = importlib.util.spec_from_file_location("aextract", "/scripts/extract.py")
AX = importlib.util.module_from_spec(_sp2); _sp2.loader.exec_module(AX)  # salience/extract.py: compute_series (holds/extract.py is HX)

CACHE = "/cache/sust_cheap"
SR, HOP, FMS = HX.SR, HX.HOP, HX.FMS
SLOW = HX.SLOW_HOP
STEP = FMS * SLOW
HD_AUDIO = HX.HD_AUDIO
GUARD_PER_MIN = 30
D2_SIM, D2_TOL = 0.9, 2
WEIGHTS = librosa.db_to_power(librosa.A_weighting(librosa.fft_frequencies(sr=SR, n_fft=2048)))[:, None]
NEW = {"d1": ["mix_len_d1", "keep_db_d1", "chroma_stab_d1", "flux_after_d1"],
       "d2": ["stab_vib", "stab_run"],
       "d3": ["mix_len_d3", "keep_db_d3", "chroma_stab_d3", "flux_after_d3"]}


# ---------------------------------------------------------------- detectors
def segments_conf(pitch, conf, energy, strikes, shift, fms):
    """holds/extract.py segments(), with the frame length as a parameter and the mean confidence kept: [t, len, conf]."""
    n = min(pitch.size, energy.size, strikes.size)
    out, s = [], 0
    for i in range(1, n + 1):
        if i < n and abs(int(pitch[i]) - int(pitch[s])) <= 1 and not strikes[i]:
            continue
        ms = (i - s) * fms
        if ms >= HX.MIN_MS and conf[s:i].mean() >= HX.CONF_FLOOR:
            third = max(1, (i - s) // 3)
            decay = 10 * np.log10((energy[i - third:i].mean() + 1e-12) / (energy[s:s + third].mean() + 1e-12))
            if decay >= HX.MAX_DECAY_DB:
                out.append((s * fms - shift, ms, float(conf[s:i].mean())))
        s = i
    return np.array(out, dtype=np.float64).reshape(-1, 3)


def slow_strikes(strikes):
    return ndi.maximum_filter1d(strikes.astype(np.float32), SLOW)[::SLOW] > 0


def d_chain(S, strikes, shift, tm=None):
    """D1 on a magnitude spectrogram S (fast frames): average to 46 ms, long-window HPSS, pitch contour, segments, chroma, flux."""
    T = {}
    t0 = time.time()
    Sa = np.maximum(ndi.uniform_filter1d(S, SLOW, axis=1)[:, ::SLOW], 0)  # float rounding can go a hair below 0
    H, _ = librosa.decompose.hpss(Sa, kernel_size=31, margin=2.0)
    T["hpss_long"] = time.time() - t0
    t0 = time.time()
    h_energy = ((H ** 2) * WEIGHTS).sum(0)
    pitch, conf = HX.contour(H, *HX.RANGES["mix"])
    st = slow_strikes(strikes)
    segs = segments_conf(pitch, conf, h_energy, st, shift, STEP)
    T["contour_segments"] = time.time() - t0
    t0 = time.time()
    chroma = librosa.feature.chroma_stft(S=H ** 2, sr=SR, n_fft=2048)
    flux = np.maximum(np.diff(librosa.power_to_db(H ** 2, ref=float((H ** 2).max()), top_db=80), axis=1, prepend=0), 0).mean(0)
    T["chroma_flux"] = time.time() - t0
    if tm is not None:
        tm.update(T)
    return dict(segs=segs, e=h_energy.astype(np.float32), chroma=chroma.astype(np.float32), flux=flux.astype(np.float32))


def tol_sim(P, Q):
    """cosine between columns of P and Q, best over +-D2_TOL chroma-bin shifts (vibrato tolerance on 36 bins)."""
    P = P / (np.linalg.norm(P, axis=0, keepdims=True) + 1e-9)
    Q = Q / (np.linalg.norm(Q, axis=0, keepdims=True) + 1e-9)
    return np.max([(P * np.roll(Q, k, axis=0)).sum(0) for k in range(-D2_TOL, D2_TOL + 1)], axis=0)


def d2_chain(H, shift, tm=None):
    """D2 from the harmonic part the analysis already has: 36-bin chroma at 46 ms and the runs where it stays put."""
    t0 = time.time()
    c36 = librosa.feature.chroma_stft(S=H ** 2, sr=SR, n_fft=2048, n_chroma=36)[:, ::SLOW].astype(np.float32)
    e = ndi.uniform_filter1d(((H ** 2) * WEIGHTS).sum(0), SLOW)[::SLOW]
    sim = tol_sim(c36[:, :-4], c36[:, 4:])
    stable = (sim >= D2_SIM) & (e[:-4] > 0.05 * np.median(e))
    stable = ndi.binary_closing(stable, structure=np.ones(3, bool))
    lab, n = ndi.label(stable)
    segs = []
    for i in range(1, n + 1):
        idx = np.where(lab == i)[0]
        ms = (len(idx) + 4) * STEP
        if ms >= HX.MIN_MS:
            segs.append((idx[0] * STEP - shift, ms, float(sim[idx].mean())))
    if tm is not None:
        tm["d2"] = time.time() - t0
    return dict(c36=c36, segs=np.array(segs, dtype=np.float64).reshape(-1, 3))


def song_detectors(path, shift, tm=None):
    t0 = time.time()
    y, _ = librosa.load(path, sr=SR, mono=False)
    y = np.atleast_2d(y)
    L, R = (y[0], y[1]) if len(y) > 1 else (y[0], y[0])
    mid = (L + R) / 2
    side = (L - R) / 2
    if tm is not None:
        tm["load"] = time.time() - t0
    t0 = time.time()
    S = np.abs(librosa.stft(mid, n_fft=2048, hop_length=HOP))
    if tm is not None:
        tm["stft_mid(not counted)"] = time.time() - t0
    out = {"dur": len(mid) / SR}
    t0 = time.time()
    strikes = HX.onset_peaks(S)
    if tm is not None:
        tm["onset_peaks"] = time.time() - t0
    # the current mix detector, for the shared chain
    t0 = time.time()
    H, _ = librosa.decompose.hpss(S, margin=2.0)
    if tm is not None:
        tm["cur_hpss"] = time.time() - t0
    t0 = time.time()
    pitch, conf = HX.contour(H, *HX.RANGES["mix"])
    h_energy = ((H ** 2) * WEIGHTS).sum(0)
    HX.segments(pitch, conf, h_energy, strikes, shift)
    librosa.feature.chroma_stft(S=H ** 2, sr=SR, hop_length=HOP)
    np.maximum(np.diff(librosa.power_to_db(H ** 2, ref=float((H ** 2).max()), top_db=80), axis=1, prepend=0), 0).mean(0)
    if tm is not None:
        tm["cur_rest"] = time.time() - t0
    # D1
    tt = {}
    out["d1"] = d_chain(S, strikes, shift, tt)
    if tm is not None:
        tm["d1"] = sum(tt.values())
        tm["d1_parts"] = tt
    # D2 (reuses H)
    tt = {}
    out["d2"] = d2_chain(H, shift, tt)
    if tm is not None:
        tm["d2"] = tt["d2"]
    # D3: centre extraction
    t0 = time.time()
    Ss = np.abs(librosa.stft(side, n_fft=2048, hop_length=HOP))
    t_stft = time.time() - t0
    t0 = time.time()
    C = S * np.clip(1.0 - Ss / (S + 1e-9), 0.0, 1.0)
    t_mask = time.time() - t0
    t0 = time.time()
    st3 = HX.onset_peaks(C)
    t_peaks = time.time() - t0
    tt = {}
    out["d3"] = d_chain(C, st3, shift, tt)
    if tm is not None:
        tm["d3"] = t_stft + t_mask + t_peaks + sum(tt.values())
    return out


def worker(sid):
    out = f"{CACHE}/{sid}.pkl"
    if os.path.exists(out):
        return sid, "cached"
    try:
        r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
        path = HD_AUDIO if sid == "hd" else glob.glob(f"{M.DATA}/audio/{sid}.*")[0]
        res = song_detectors(path, r["shift_ms"]["mel"])
        pickle.dump(res, open(out, "wb"))
        return sid, "ok"
    except Exception:
        import traceback
        return sid, "ERR " + traceback.format_exc()[-600:]


# ---------------------------------------------------------------- moment features
def feats_from(ms, beat, d, shift):
    e, chroma, flux, segs = d["e"], d["chroma"], d["flux"], d["segs"]
    a0, a1 = M.window(e, ms, 0, beat / 4, STEP, shift)
    b0, b1 = M.window(e, ms, beat / 2, beat, STEP, shift)
    f0, f1 = M.window(flux, ms, 60, beat, STEP, shift)
    c0, c1 = M.window(chroma, ms, 0, beat / 4, STEP, shift)
    d0, d1 = M.window(chroma, ms, 3 * beat / 4, beat, STEP, shift)
    keep, stab, after = [], [], []
    for i in range(len(ms)):
        keep.append(10 * np.log10((e[b0[i]:b1[i]].mean() + 1e-9) / (e[a0[i]:a1[i]].mean() + 1e-9)))
        after.append(flux[f0[i]:f1[i]].mean())
        p, q = chroma[:, c0[i]:c1[i]].mean(1), chroma[:, d0[i]:d1[i]].mean(1)
        stab.append(float(p @ q / (np.linalg.norm(p) * np.linalg.norm(q) + 1e-9)))
    return [M.len_at(ms, segs[:, :2], M.HEAD_MS) / beat, np.array(keep), np.array(stab), -np.array(after)]


def d2_feats(ms, beat, d, shift):
    c = d["c36"]
    w = lambda a, b: np.stack([c[:, i:j].mean(1) for i, j in zip(*M.window(c, ms, a, b, STEP, shift))], 1)
    head, tail = w(0, beat / 4), w(3 * beat / 4, beat)
    qs = [w(k * beat / 4, (k + 1) * beat / 4) for k in range(4)]
    return [tol_sim(head, tail), np.min([tol_sim(qs[k], qs[k + 1]) for k in range(3)], axis=0)]


# ---------------------------------------------------------------- evaluation (the same recipe as holds/measure.py hears_long_sound)
def hears(rows, cols):
    target = {s: d["stem_len"] >= M.LONG_BEATS for s, d in rows.items()}
    good = {s: d for s, d in rows.items() if 5 <= target[s].sum() < len(target[s]) - 5}
    ids = sorted(good)
    fold = {s: i % 5 for i, s in enumerate(np.random.default_rng(4).permutation(ids))}
    rk = {s: np.column_stack([rankdata(d[k]) / len(d[k]) for k in cols]) for s, d in good.items()}
    aucs, top = [], []
    for f in range(5):
        tr = [s for s in ids if fold[s] != f]
        m = LogisticRegression(C=1.0, max_iter=400, class_weight="balanced").fit(np.concatenate([rk[s] for s in tr]), np.concatenate([target[s] for s in tr]))
        for s in ids:
            if fold[s] == f:
                p = m.predict_proba(rk[s])[:, 1]
                aucs.append(auc_fast(p, target[s]))
                top.append(target[s][np.argsort(-p)[:int(target[s].sum())]].mean())
    return {"songs": len(ids), "base_rate": round(float(np.mean([target[s].mean() for s in ids])), 3),
            "auc": round(float(np.nanmedian(aucs)), 3), "precision_at_k": round(float(np.mean(top)), 3),
            "single": {k: round(float(np.nanmedian([auc_fast(good[s][k], target[s]) for s in ids])), 3) for k in cols}}


def seen(ls, seg):
    n = 0
    for t, l, _ in ls:
        if len(seg):
            n += int((np.minimum(t + l, seg[:, 0] + seg[:, 1]) - np.maximum(t, seg[:, 0]) >= .5 * l).any())
    return n


def guarded(seg, dur_s, cap):
    if not cap:
        return seg
    k = int(np.ceil(GUARD_PER_MIN * dur_s / 60))
    return seg[np.argsort(-seg[:, 2])[:k]] if len(seg) > k else seg


def main():
    ids = M.train_ids()
    print(len(ids), "train songs; test songs not read", flush=True)
    os.makedirs(CACHE, exist_ok=True)
    import multiprocessing as mp
    t0 = time.time()
    with mp.Pool(5) as pool:
        for sid, msg in pool.imap_unordered(worker, ids + ["hd"]):
            if msg.startswith("ERR"):
                print(sid, msg, flush=True)
    print("detectors ready", round(time.time() - t0), "s", flush=True)

    rows = {lv: {} for lv in LV}
    ls_all, segs_all, meta = {}, {}, {}
    for n, sid in enumerate(ids):
        r, x, f, lead, bass = M.load_song(sid)
        beat = 60000.0 / r["bpm"]
        d = pickle.load(open(f"{CACHE}/{sid}.pkl", "rb"))
        sounds = M.stack(x["stems"])
        ls_all[sid] = M.long_sounds(sounds, beat)
        meta[sid] = (beat, d["dur"])
        segs_all[sid] = {"cur_mix": x["mix"].astype(np.float64)[:, [0, 1, 3]], "lead_bass": np.concatenate([lead, bass])[:, :2], "d1": d["d1"]["segs"], "d2": d["d2"]["segs"], "d3": d["d3"]["segs"]}
        for lv in LV:
            c = M.chart(f"{M.DATA}/human/{lv}/{sid}.json", True)
            if c is None or len(c["t"]) == 0:
                continue
            m = M.moment_rows(c, r, x, beat, sounds, lead, bass)
            if m is None:
                continue
            ms = M.moments(c["t"])
            shift = x["shift"]
            for dn in ("d1", "d3"):
                for k, v in zip(NEW[dn], feats_from(ms, beat, d[dn], shift)):
                    m[k] = v
            for k, v in zip(NEW["d2"], d2_feats(ms, beat, d["d2"], shift)):
                m[k] = v
            rows[lv][sid] = m
        if n % 10 == 0:
            print("moments", n, sid, flush=True)

    R = {"levels": {}, "coverage": {}, "cost": {}}
    sets = {"current (CHEAP)": M.CHEAP,
            "D1 + CHEAP": M.CHEAP + NEW["d1"], "D2 + CHEAP": M.CHEAP + NEW["d2"], "D3 + CHEAP": M.CHEAP + NEW["d3"],
            "D1+D2+D3 + CHEAP": M.CHEAP + NEW["d1"] + NEW["d2"] + NEW["d3"],
            "D1 alone": NEW["d1"], "D2 alone": NEW["d2"], "D3 alone": NEW["d3"]}
    for lv in LV:
        R["levels"][lv] = {}
        for name, cols in sets.items():
            R["levels"][lv][name] = hears(rows[lv], cols)
            print(lv, name, {k: v for k, v in R["levels"][lv][name].items() if k != "single"}, flush=True)
        print(lv, "single AUC", R["levels"][lv]["D1+D2+D3 + CHEAP"]["single"], flush=True)

    # coverage of the long sounds
    total = sum(len(v) for v in ls_all.values())
    per_min = {dn: [] for dn in ("cur_mix", "d1", "d2", "d3")}
    for sid in ids:
        beat, dur = meta[sid]
        for dn in per_min:
            s = segs_all[sid][dn]
            per_min[dn].append(int((s[:, 1] >= beat).sum()) / (dur / 60))
    cap = {dn: float(np.median(v)) > GUARD_PER_MIN for dn, v in per_min.items()}
    R["coverage"]["segments_per_min_median"] = {dn: round(float(np.median(v)), 1) for dn, v in per_min.items()}
    R["coverage"]["guard_applied"] = cap
    print("long sounds", total, "segments per minute", R["coverage"]["segments_per_min_median"], "guard", cap, flush=True)

    def cov(names):
        n = 0
        for sid in ids:
            beat, dur = meta[sid]
            segs = []
            for dn in names:
                s = segs_all[sid][dn]
                s = s[s[:, 1] >= beat]
                segs.append(guarded(s, dur, cap.get(dn, False))[:, :2] if len(s) else s[:, :2])
            n += seen(ls_all[sid], np.concatenate(segs) if segs else np.zeros((0, 2)))
        return round(n / max(total, 1), 3)
    for key, names in {"cur_mix": ["cur_mix"], "d1": ["d1"], "d2": ["d2"], "d3": ["d3"], "d1+d2+d3": ["d1", "d2", "d3"],
                       "d1+cur_mix": ["d1", "cur_mix"], "d2+cur_mix": ["d2", "cur_mix"], "d3+cur_mix": ["d3", "cur_mix"],
                       "all+cur_mix": ["d1", "d2", "d3", "cur_mix"], "all+cur_mix+lead_bass": ["d1", "d2", "d3", "cur_mix", "lead_bass"]}.items():
        R["coverage"][key] = cov(names)
    print("coverage", R["coverage"], flush=True)

    # cost: three songs of timing.py, one thread, in this session
    ids3 = ["1127488", "1141872", "1196084"]
    tot_min, agg = 0.0, {}
    cs_wall = 0.0
    for sid in ids3:
        path = glob.glob(f"{M.DATA}/audio/{sid}.*")[0]
        r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
        t0 = time.time()
        _, dur, _ = AX.compute_series(path)
        cs_wall += time.time() - t0
        tm = {}
        song_detectors(path, r["shift_ms"]["mel"], tm)
        tot_min += dur / 60
        for k, v in tm.items():
            if k != "d1_parts":
                agg[k] = agg.get(k, 0) + v
    base = cs_wall / tot_min
    per = {k: v / tot_min for k, v in agg.items()}
    R["cost"] = {"audio_minutes": round(tot_min, 2), "compute_series_s_per_min": round(base, 2),
                 "components_s_per_min": {k: round(v, 3) for k, v in per.items()}}
    shared = per["onset_peaks"] + per["cur_rest"]   # contour, segments, chroma, flux of the current detector; its own HPSS is not counted (H can be shared)
    R["cost"]["share_of_analysis"] = {
        "d1": round(per["d1"] / base, 3), "d2": round(per["d2"] / base, 3), "d3": round(per["d3"] / base, 3),
        "d1+d2+d3": round((per["d1"] + per["d2"] + per["d3"]) / base, 3),
        "shared_chain(cur_rest+onset_peaks)": round(shared / base, 3),
        "d1+shared": round((per["d1"] + shared) / base, 3), "d2+shared": round((per["d2"] + shared) / base, 3),
        "d3+shared": round((per["d3"] + per["cur_rest"]) / base, 3), "all+shared": round((per["d1"] + per["d2"] + per["d3"] + shared) / base, 3)}
    print("cost", json.dumps(R["cost"]), flush=True)

    # verdict, as written in REPORT.md: (AUC >= .72 or precision >= .15) and coverage >= .35 and cost <= 20%
    cov_of = {"D1 + CHEAP": R["coverage"]["d1"], "D2 + CHEAP": R["coverage"]["d2"], "D3 + CHEAP": R["coverage"]["d3"], "D1+D2+D3 + CHEAP": R["coverage"]["d1+d2+d3"]}
    cost_new = {"D1 + CHEAP": "d1", "D2 + CHEAP": "d2", "D3 + CHEAP": "d3", "D1+D2+D3 + CHEAP": "d1+d2+d3"}
    cost_all = {"D1 + CHEAP": "d1+shared", "D2 + CHEAP": "d2+shared", "D3 + CHEAP": "d3+shared", "D1+D2+D3 + CHEAP": "all+shared"}
    V = {}
    for name in cov_of:
        for lv in LV:
            m = R["levels"][lv][name]
            acc = m["auc"] >= .72 or m["precision_at_k"] >= .15
            c = cov_of[name] >= .35
            k1 = R["cost"]["share_of_analysis"][cost_new[name]] <= .2
            k2 = R["cost"]["share_of_analysis"][cost_all[name]] <= .2
            V[f"{name}|{lv}"] = {"accuracy": bool(acc), "coverage": bool(c), "cost_new_only": bool(k1), "cost_with_shared_chain": bool(k2),
                                 "pass": bool(acc and c and k1), "pass_strict": bool(acc and c and k2)}
    R["verdict"] = V
    R["any_pass_normal"] = any(v["pass"] for k, v in V.items() if k.endswith("|normal"))
    R["any_pass_any_level"] = any(v["pass"] for v in V.values())
    print("verdict", json.dumps(V, indent=1), flush=True)
    print("any set passes on Normal:", R["any_pass_normal"], "| on any level:", R["any_pass_any_level"], flush=True)

    # Hopes and Dreams: what each detector sees (no human map exists)
    r, x, f, lead, bass = M.load_song("hd")
    beat = 60000.0 / r["bpm"]
    ls = M.long_sounds(M.stack(x["stems"]), beat)
    d = pickle.load(open(f"{CACHE}/hd.pkl", "rb"))
    hd = {"long_sounds": len(ls), "minutes": round(d["dur"] / 60, 2), "parts": []}
    sg = {"cur_mix": x["mix"].astype(np.float64)[:, [0, 1, 3]], "d1": d["d1"]["segs"], "d2": d["d2"]["segs"], "d3": d["d3"]["segs"]}
    hd["segments_per_min"] = {k: round(int((v[:, 1] >= beat).sum()) / (d["dur"] / 60), 1) for k, v in sg.items()}
    sg_g = {k: guarded(v[v[:, 1] >= beat], d["dur"], True)[:, :2] if len(v[v[:, 1] >= beat]) else v[:0, :2] for k, v in sg.items()}
    hd["seen"] = {k: seen(ls, v) for k, v in sg_g.items()}
    for a, b, name in M.HD_PARTS:
        m = (ls[:, 0] >= a * 1000) & (ls[:, 0] < b * 1000)
        hd["parts"].append({"part": name, "long_sounds": int(m.sum()), **{k: seen(ls[m], v) for k, v in sg_g.items()}})
    R["hd"] = hd
    print("hd", json.dumps(hd, ensure_ascii=False), flush=True)
    json.dump(R, open("/cache/sustain_cheap.json", "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
