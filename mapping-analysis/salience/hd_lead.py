# Not for the repo: why does the lead tracker go quiet after 22 s of Hopes and Dreams?
# Mimics PitchTracker's gates one by one on the same song, per part the user labelled.
import sys
import numpy as np, librosa

wav = sys.argv[1]
NAMES = [(0, 20, "violins"), (22, 45, "main melody"), (45, 67, "guitar alone"), (67, 79, "guitar+melody"),
         (79, 90, "guitar+bell/flute"), (90, 112, "melody/flute"), (112, 185, "unlabelled")]
y, sr = librosa.load(wav, sr=22050, mono=True)

def contour(n_fft, hop):
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    H, _ = librosa.decompose.hpss(S, margin=2.0)
    fb = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    midi = np.arange(55, 97)
    Hn = H / (H.max(0, keepdims=True) + 1e-9)
    sal = np.zeros((midi.size, H.shape[1]))
    for m, f in enumerate(librosa.midi_to_hz(midi)):
        for h, w in enumerate([1.0, 0.8, 0.64, 0.51, 0.41]):
            if f * (h + 1) < sr / 2:
                sal[m] += w * Hn[np.argmin(np.abs(fb - f * (h + 1)))] ** 0.5
    return midi[sal.argmax(0)], sal.max(0) / (np.median(sal, axis=0) + 1e-9), sr / hop

def notes(pitch, conf, fps, tol, min_ms, floor):
    out, s = [], 0
    for i in range(1, pitch.size + 1):
        if i == pitch.size or abs(int(pitch[i]) - int(pitch[s])) > tol:
            d = (i - s) / fps * 1000
            if d >= min_ms and conf[s:i].mean() >= floor:
                out.append((s / fps, d, int(pitch[s])))
            s = i
    return out

for label, n_fft, hop in (("fft 4096 (like plugin)", 4096, 512), ("fft 2048", 2048, 256), ("fft 1024", 1024, 128)):
    pitch, conf, fps = contour(n_fft, hop)
    print(f"--- {label}, hop {hop}: notes/s, share of time covered, median length ms")
    for tol, min_ms in ((0, 150), (1, 150), (1, 90), (1, 60)):
        row = []
        ns = notes(pitch, conf, fps, tol, min_ms, 2.0)
        for a, b, name in NAMES:
            ins = [n for n in ns if a <= n[0] < b]
            row.append(f"{name[:12]} {len(ins)/(b-a):4.1f} {sum(n[1] for n in ins)/10/(b-a):3.0f}% {np.median([n[1] for n in ins]) if ins else 0:4.0f}")
        print(f"tol {tol} min {min_ms:3d}: " + " | ".join(row))
