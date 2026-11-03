"""Stems (drums / bass / vocals / other) with Spleeter 4stems and their onsets, for the metrics' stem columns.

Runs in its own environment (Spleeter 2.4 needs TensorFlow 2.9, Python 3.10, numpy < 2):

    uv python install 3.10 && uv venv -p 3.10 <venv> && VIRTUAL_ENV=<venv> uv pip install spleeter==2.4.0 "numpy<2" librosa==0.10.2.post1
    curl -L -o 4stems.tar.gz https://github.com/deezer/spleeter/releases/download/v1.4.0/4stems.tar.gz  # model weights
    <venv>/bin/python -I stems.py --models <dir containing 4stems/> <audio file> <out.npz>

Writes, per stem, the onset envelope and picked onsets on the same frame grid as librosa_features.py (22050 Hz, hop
256), plus the stem's RMS, so audio_metrics can treat a stem like any other detector. The separated audio itself is
not kept.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

SR_SEP = 44100
SR = 22050
HOP = 256
STEMS = ("drums", "bass", "vocals", "other")


def decode_stereo(audio: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(audio), "-vn", "-ac", "2", "-ar", str(SR_SEP), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float32)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=Path, required=True, help="folder that contains 4stems/")
    ap.add_argument("audio", type=Path)
    ap.add_argument("out", type=Path)
    args = ap.parse_args(argv)
    os.environ["MODEL_PATH"] = str(args.models)
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    import librosa  # noqa: PLC0415 - after the environment is set
    from spleeter.separator import Separator  # noqa: PLC0415

    waveform = decode_stereo(args.audio)
    separated = Separator("spleeter:4stems", multiprocess=False).separate(waveform)
    out = {"sr": np.array(SR), "hop": np.array(HOP)}
    for stem in STEMS:
        mono = librosa.resample(separated[stem].mean(axis=1), orig_sr=SR_SEP, target_sr=SR)
        S = np.abs(librosa.stft(mono, n_fft=2048, hop_length=HOP))
        M = librosa.power_to_db(librosa.feature.melspectrogram(S=S**2, sr=SR, n_mels=128))
        env = librosa.onset.onset_strength(S=M, sr=SR)
        frames = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, backtrack=False, units="frames")
        out[f"env_stem_{stem}"] = env.astype(np.float32)
        out[f"onsets_stem_{stem}"] = (librosa.frames_to_time(frames, sr=SR, hop_length=HOP) * 1000.0).astype(np.float32)
        out[f"rms_stem_{stem}"] = librosa.feature.rms(S=S, frame_length=2048, hop_length=HOP)[0].astype(np.float32)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **out)
    print(f"{args.audio.name}: " + ", ".join(f"{s} {len(out[f'onsets_stem_{s}'])} onsets" for s in STEMS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
