# Per-candidate signals from the separated instruments. Same candidates as /scripts/feat/<id>.pkl.
# In mewbeat-ma: /scripts = the salience dir with feat/, /listening = listening dir, /out = .mewbeat-debug.
# stem_features.py [--jobs 8] [--ids a,b] -> /out/data/stems/_feat/<id>.pkl
import os, sys, glob, pickle, argparse
for k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[k] = "1"
import numpy as np
import scipy.ndimage as ndi
import librosa

sys.path.insert(0, "/listening")
from build_variants import contour, note_starts, near

STEMS_DIR = "/out/data/stems"
OUT = f"{STEMS_DIR}/_feat"
SR, HOP = 22050, 256
FMS = 1000.0 * HOP / SR
STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
PITCHED = ("other", "vocals", "guitar", "piano")
MIN_SHARE = 0.10  # below this the stem is not really playing, so its contour is only bleed


def onset_series(mel, ref):
    db = np.maximum(librosa.power_to_db(mel, ref=ref, top_db=None), -80.0)
    return librosa.onset.onset_strength(S=db, sr=SR, hop_length=HOP)


def relative(os_, floor):
    w = int(round(2000 / FMS))
    return os_ / (ndi.uniform_filter1d(os_, w, mode="nearest") + floor)


def build(sid, r):
    ys = {s: librosa.load(f"{STEMS_DIR}/{sid}/{s}.flac", sr=SR, mono=True)[0] for s in STEMS}
    n = min(len(y) for y in ys.values())
    ys = {s: y[:n] for s, y in ys.items()}
    mels = {s: librosa.feature.melspectrogram(y=y, sr=SR, n_fft=2048, hop_length=HOP) for s, y in ys.items()}
    T = next(iter(mels.values())).shape[1]
    mix = sum(mels.values())
    ref = float(mix.max())
    no_drums = mix - mels["drums"]

    os_ = {s: onset_series(mels[s], ref)[:T] for s in STEMS}
    floor = 0.05 * onset_series(mix, ref).mean()
    rel = {s: relative(os_[s], floor) for s in STEMS}
    rel_no_drums = relative(onset_series(np.maximum(no_drums, 1e-12), ref)[:T], floor)

    # A-weighted, so the share follows what is heard: raw power gives the bass most of every song.
    weights = librosa.db_to_power(librosa.A_weighting(librosa.mel_frequencies(n_mels=mix.shape[0], fmax=SR / 2)))[:, None]
    energy = {s: (mels[s] * weights).sum(0) for s in STEMS}
    total = sum(energy.values()) + 1e-12
    def share(win_ms):
        w = max(1, int(round(win_ms / FMS)))
        tot = ndi.uniform_filter1d(total, w, mode="nearest")
        return {s: ndi.uniform_filter1d(energy[s], w, mode="nearest") / tot for s in STEMS}
    short, long_ = share(170), share(4000)

    t = r["t"]
    shift = r["shift_ms"]["mel"]
    fr = np.clip(np.round((t + shift) / FMS).astype(int), 0, T - 1)
    peak = lambda v: ndi.maximum_filter1d(v, 5)[fr]

    half_ms = 30000.0 / r["bpm"] if r["bpm"] else 250.0
    notes = {}
    for s in PITCHED:
        pitch, conf, fps = contour(ys[s], SR)
        m = note_starts(pitch[:T], conf[:T], fps, 0.4 * half_ms)
        idx = np.clip(np.round(m / FMS).astype(int), 0, T - 1) if len(m) else np.zeros(0, int)
        notes[s] = m[long_[s][idx] >= MIN_SHARE] if len(m) else m

    lead_i = np.stack([long_[s] for s in PITCHED]).argmax(0)[fr]
    pick = lambda d: np.stack([d[s] for s in PITCHED])
    os_p, rel_p = pick({s: ndi.maximum_filter1d(os_[s], 5)[fr] for s in PITCHED}), pick({s: peak(rel[s]) for s in PITCHED})
    note_p = np.stack([near(t, notes[s], 40) for s in PITCHED]).astype(np.float32)
    wide = np.arange(len(t))
    sl = np.stack([long_[s][fr] for s in PITCHED])

    cols = {}
    for s in STEMS:
        cols[f"s_os_{s}"] = peak(os_[s])
        cols[f"s_rel_{s}"] = peak(rel[s])
        cols[f"s_short_{s}"] = short[s][fr]
        cols[f"s_long_{s}"] = long_[s][fr]
    for j, s in enumerate(PITCHED):
        cols[f"s_note_{s}"] = note_p[j]
    cols["s_lead_os"] = os_p[lead_i, wide]
    cols["s_lead_rel"] = rel_p[lead_i, wide]
    cols["s_lead_note"] = note_p[lead_i, wide]
    cols["s_fg"] = (sl * rel_p).sum(0)
    cols["s_pitched_max"] = os_p.max(0)
    cols["s_rel_no_drums"] = peak(rel_no_drums)

    names = list(cols)
    X = np.stack([cols[k] for k in names], 1).astype(np.float32)
    per_sec = int(round(1000 / FMS))
    return {"names": names, "X": X, "t": t, "notes": notes,
            "share_1hz": {s: long_[s][::per_sec].astype(np.float32) for s in STEMS}}


def do(sid):
    out = f"{OUT}/{sid}.pkl"
    if os.path.exists(out):
        return sid, "skip"
    try:
        r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
        res = build(sid, r)
        pickle.dump(res, open(out, "wb"))
        return sid, f"ok {res['X'].shape}"
    except Exception:
        import traceback
        return sid, "ERR " + traceback.format_exc()[-500:]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--ids", default="")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ids = a.ids.split(",") if a.ids else sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(f"{STEMS_DIR}/*/piano.flac"))
    import multiprocessing as mp
    with mp.Pool(a.jobs) as pool:
        for sid, msg in pool.imap_unordered(do, ids):
            print(sid, msg, flush=True)
