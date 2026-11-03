"""Audio features independent of the mewbeat plugin, for judging human and algorithm charts alike.

    python3 -I librosa_features.py <audio file> <out.npz>

Decodes with ffmpeg (as extract_features.py does, so both share one timeline), then computes with librosa:
onset envelopes of the full mix, of the percussive and harmonic parts (HPSS), and of four bands matching the
plugin's (20-150, 150-800, 800-4000, 4000-11025 Hz); picked onsets of each; RMS; harmonic chroma; MFCC.
Stems (drums / bass / vocals / other) would need a separation model; see shared/metrics.md, "Stemy".
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 256  # 11.6 ms
N_FFT = 2048
N_MELS = 128
BAND_EDGES_HZ = (20, 150, 800, 4000, SR / 2)
BAND_NAMES = ("low", "lowmid", "highmid", "high")


def decode_mono(audio: Path, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(audio), "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float32)


def onsets(env: np.ndarray) -> np.ndarray:
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, backtrack=False, units="frames")
    return (librosa.frames_to_time(frames, sr=SR, hop_length=HOP) * 1000.0).astype(np.float32)


def compute(y: np.ndarray) -> dict[str, np.ndarray]:
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    H, P = librosa.decompose.hpss(S)
    mel = lambda X: librosa.power_to_db(librosa.feature.melspectrogram(S=X**2, sr=SR, n_mels=N_MELS))
    M, MP, MH = mel(S), mel(P), mel(H)
    env = {
        "full": librosa.onset.onset_strength(S=M, sr=SR),
        "perc": librosa.onset.onset_strength(S=MP, sr=SR),
        "harm": librosa.onset.onset_strength(S=MH, sr=SR),
    }
    freqs = librosa.mel_frequencies(n_mels=N_MELS, fmin=0.0, fmax=SR / 2)
    edges = [int(np.searchsorted(freqs, f)) for f in BAND_EDGES_HZ]
    edges[-1] = N_MELS
    bands = librosa.onset.onset_strength_multi(S=M, sr=SR, channels=edges)
    for name, b in zip(BAND_NAMES, bands):
        env[name] = b
    out: dict[str, np.ndarray] = {"sr": np.array(SR), "hop": np.array(HOP), "duration_ms": np.array(len(y) * 1000.0 / SR)}
    for k, e in env.items():
        out[f"env_{k}"] = e.astype(np.float32)
        out[f"onsets_{k}"] = onsets(e)
    out["rms"] = librosa.feature.rms(S=S, frame_length=N_FFT, hop_length=HOP)[0].astype(np.float32)
    out["chroma"] = librosa.feature.chroma_stft(S=H**2, sr=SR, hop_length=HOP).astype(np.float32)
    out["mfcc"] = librosa.feature.mfcc(S=M, n_mfcc=13).astype(np.float32)
    return out


def frame_times_ms(n: int) -> np.ndarray:
    return librosa.frames_to_time(np.arange(n), sr=SR, hop_length=HOP) * 1000.0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        print(__doc__)
        return 2
    audio, out = Path(argv[0]), Path(argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    feats = compute(decode_mono(audio))
    np.savez_compressed(out, **feats)
    print(f"{audio.name}: {float(feats['duration_ms']) / 1000:.1f} s, onsets full {len(feats['onsets_full'])}, perc {len(feats['onsets_perc'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
