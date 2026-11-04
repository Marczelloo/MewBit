# Sustained sounds of every song: from the separated instruments (a reference only, not for production) and from the mix.
# In mewbeat-ma: /scripts = the salience dir with feat/, /out = .mewbeat-debug, /repo = the repository, read-only.
# extract.py [--jobs 6] [--ids a,b] -> /out/data/stems/_sust/<id>.pkl
import os, sys, glob, pickle, argparse
for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[k] = "1"
import numpy as np
import scipy.ndimage as ndi
import librosa

STEMS_DIR = "/out/data/stems"
OUT = f"{STEMS_DIR}/_sust"
HD_AUDIO = "/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.pcm.wav"
SR, HOP = 22050, 256
FMS = 1000.0 * HOP / SR
STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
RANGES = {"bass": (28, 60), "other": (48, 97), "vocals": (48, 90), "guitar": (40, 92), "piano": (40, 97), "mix": (40, 97)}
MIN_MS = 200       # shorter than this is no sustain at any tempo
CONF_FLOOR = 2.0   # same floor as the listening contours
MAX_DECAY_DB = -15 # a note fading further than this over its span has stopped sounding
SLOW_HOP = 4       # chroma and harmonic flux are kept at about 46 ms


def contour(H, lo, hi):
    fb = librosa.fft_frequencies(sr=SR, n_fft=2048)
    midi = np.arange(lo, hi)
    Hn = H / (H.max(0, keepdims=True) + 1e-9)
    sal = np.zeros((midi.size, H.shape[1]))
    for m, f in enumerate(librosa.midi_to_hz(midi)):
        for h, w in enumerate([1.0, 0.8, 0.64, 0.51, 0.41]):
            if f * (h + 1) < SR / 2:
                sal[m] += w * Hn[np.argmin(np.abs(fb - f * (h + 1)))] ** 0.5
    return ndi.median_filter(midi[sal.argmax(0)], size=5), sal.max(0) / (np.median(sal, axis=0) + 1e-9)


def onset_peaks(S):
    """Frames where the sound is struck again, so one repeated pitch stays several notes."""
    os_ = librosa.onset.onset_strength(S=librosa.power_to_db(S ** 2, ref=float((S ** 2).max()), top_db=80), sr=SR, hop_length=HOP)
    w = int(round(2000 / FMS))
    mean = ndi.uniform_filter1d(os_, w, mode="nearest")
    sq = ndi.uniform_filter1d(os_ ** 2, w, mode="nearest")
    thr = mean + 1.5 * np.sqrt(np.maximum(sq - mean ** 2, 0))
    return (os_ == ndi.maximum_filter1d(os_, 7)) & (os_ > thr)


def segments(pitch, conf, energy, strikes, shift):
    """[t, len, pitch, decay_db] of the stretches where one pitch keeps sounding."""
    n = min(pitch.size, energy.size, strikes.size)
    out, s = [], 0
    for i in range(1, n + 1):
        if i < n and abs(int(pitch[i]) - int(pitch[s])) <= 1 and not strikes[i]:
            continue
        ms = (i - s) * FMS
        if ms >= MIN_MS and conf[s:i].mean() >= CONF_FLOOR:
            third = max(1, (i - s) // 3)
            decay = 10 * np.log10((energy[i - third:i].mean() + 1e-12) / (energy[s:s + third].mean() + 1e-12))
            if decay >= MAX_DECAY_DB:
                out.append((s * FMS - shift, ms, int(pitch[s]), float(decay), s, i))
        s = i
    return out


def harmonic(y):
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    H, _ = librosa.decompose.hpss(S, margin=2.0)
    return S, H


def build(sid, r):
    shift = r["shift_ms"]["mel"]
    res = {"bpm": r["bpm"], "dur": r["dur"], "stems": {}}
    ys = {s: librosa.load(f"{STEMS_DIR}/{sid}/{s}.flac", sr=SR, mono=True)[0] for s in STEMS}
    n = min(len(y) for y in ys.values())
    weights = librosa.db_to_power(librosa.A_weighting(librosa.fft_frequencies(sr=SR, n_fft=2048)))[:, None]
    energy, spec = {}, {}
    for s in STEMS:
        S = np.abs(librosa.stft(ys[s][:n], n_fft=2048, hop_length=HOP))
        energy[s] = ((S ** 2) * weights).sum(0)
        spec[s] = S
    total = sum(energy.values()) + 1e-12
    w = int(round(170 / FMS))
    smooth_total = ndi.uniform_filter1d(total, w, mode="nearest")
    for s in STEMS:
        if s == "drums":
            continue
        H, _ = librosa.decompose.hpss(spec[s], margin=2.0)
        pitch, conf = contour(H, *RANGES[s])
        share = ndi.uniform_filter1d(energy[s], w, mode="nearest") / smooth_total
        segs = segments(pitch, conf, energy[s], onset_peaks(spec[s]), shift)
        res["stems"][s] = np.array([(t, ms, p, d, share[a:b].mean()) for t, ms, p, d, a, b in segs], dtype=np.float32).reshape(-1, 5)

    res["stem_energy"] = {s: slow(energy[s]) for s in STEMS}
    y = librosa.load(HD_AUDIO if sid == "hd" else glob.glob(f"/out/data/audio/{sid}.*")[0], sr=SR, mono=True)[0]
    S, H = harmonic(y)
    pitch, conf = contour(H, *RANGES["mix"])
    h_energy = ((H ** 2) * weights).sum(0)
    segs = segments(pitch, conf, h_energy, onset_peaks(S), shift)
    res["mix"] = np.array([(t, ms, p, d, 1.0) for t, ms, p, d, _, _ in segs], dtype=np.float32).reshape(-1, 5)
    chroma = librosa.feature.chroma_stft(S=H ** 2, sr=SR, hop_length=HOP)
    flux = np.maximum(np.diff(librosa.power_to_db(H ** 2, ref=float((H ** 2).max()), top_db=80), axis=1, prepend=0), 0).mean(0)
    res["slow_ms"] = FMS * SLOW_HOP
    res["shift"] = shift
    res["chroma"] = chroma[:, ::SLOW_HOP].astype(np.float32)
    res["h_energy"] = slow(h_energy)
    res["h_flux"] = slow(flux)
    return res


def slow(series):
    return ndi.uniform_filter1d(series, SLOW_HOP)[::SLOW_HOP].astype(np.float32)


def stem_energy(sid):
    weights = librosa.db_to_power(librosa.A_weighting(librosa.fft_frequencies(sr=SR, n_fft=2048)))[:, None]
    out = {}
    for s in STEMS:
        y = librosa.load(f"{STEMS_DIR}/{sid}/{s}.flac", sr=SR, mono=True)[0]
        out[s] = slow(((np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)) ** 2) * weights).sum(0))
    return out


def do(sid):
    out = f"{OUT}/{sid}.pkl"
    if os.path.exists(out):
        res = pickle.load(open(out, "rb"))
        if "stem_energy" in res:
            return sid, "skip"
        res["stem_energy"] = stem_energy(sid)
        pickle.dump(res, open(out, "wb"))
        return sid, "ok energy"
    try:
        r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
        res = build(sid, r)
        pickle.dump(res, open(out, "wb"))
        return sid, "ok " + " ".join(f"{k}={len(v)}" for k, v in res["stems"].items()) + f" mix={len(res['mix'])}"
    except Exception:
        import traceback
        return sid, "ERR " + traceback.format_exc()[-500:]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--ids", default="")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ids = a.ids.split(",") if a.ids else sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(f"{STEMS_DIR}/*/piano.flac"))
    import multiprocessing as mp
    with mp.Pool(a.jobs) as pool:
        for sid, msg in pool.imap_unordered(do, ids):
            print(sid, msg, flush=True)
