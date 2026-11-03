"""Bias of every onset detector against a signal with known onsets (shared/onset_bias.json).

    python3 -I calibrate_onsets.py --build <classes dir> --work <scratch dir> --out <onset_bias.json>

Synthesises 4 minutes of kick / snare / hat / tonal-note events at known times (with jitter so the detector frames
do not line up with them), runs both the librosa features and the plugin DSP on it and reports, per detector, the
median signed error (detected - true) and the share of events found within 25 ms. Pipeline metrics subtract the
librosa biases; the plugin's own errors are reported only (the generator uses its events as they are).
"""

from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_features  # noqa: E402
import librosa_features  # noqa: E402

SR = 48000
RNG = np.random.default_rng(7)


def synth() -> tuple[np.ndarray, dict[str, list[float]]]:
    dur = 240.0
    y = np.zeros(int(dur * SR))
    truth: dict[str, list[float]] = {"kick": [], "snare": [], "hat": [], "tone": []}
    t = 1.0
    k = 0
    while t < dur - 1.0:
        kind = ("kick", "hat", "snare", "hat", "tone")[k % 5]
        n = int(0.4 * SR)
        x = np.arange(n) / SR
        if kind == "kick":
            f = 50 + 70 * np.exp(-x * 40)
            s = 0.9 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 18)
        elif kind == "snare":
            s = 0.5 * RNG.standard_normal(n) * np.exp(-x * 25) + 0.4 * np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30)
        elif kind == "hat":
            noise = RNG.standard_normal(n)
            s = 0.3 * np.diff(np.diff(noise, prepend=0), prepend=0) * np.exp(-x * 70)
        else:
            f0 = 220 * 2 ** (RNG.integers(0, 24) / 12)
            env = np.minimum(1, x / 0.005) * np.exp(-x * 3)
            s = 0.35 * env * sum((0.7 ** h) * np.sin(2 * np.pi * f0 * (h + 1) * x) for h in range(6))
        i = int(round(t * SR))
        y[i:i + n] += s[: max(0, min(n, len(y) - i))]
        truth[kind].append(t * 1000.0)
        t += 0.31 + RNG.uniform(0, 0.09)
        k += 1
    y = 0.3 * np.sin(2 * np.pi * 110 * np.arange(len(y)) / SR) * 0.05 + y  # a quiet drone, as in real mixes
    return np.clip(y, -1, 1), truth


def write_wav(path: Path, y: np.ndarray) -> None:
    pcm = (np.repeat(y[:, None], 2, axis=1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def score(detected: np.ndarray, true: list[float]) -> dict:
    detected = np.sort(np.asarray(detected, dtype=float))
    errs = []
    for t in true:
        if len(detected) == 0:
            break
        i = np.searchsorted(detected, t)
        cand = [detected[j] for j in (i - 1, i) if 0 <= j < len(detected)]
        e = min(cand, key=lambda d: abs(d - t)) - t
        if abs(e) <= 50:
            errs.append(e)
    errs = np.array(errs)
    found = (np.abs(errs) <= 25).sum() / max(1, len(true))
    return {"median_ms": float(np.median(errs)) if len(errs) else None, "p10_ms": float(np.quantile(errs, 0.1)) if len(errs) else None,
            "p90_ms": float(np.quantile(errs, 0.9)) if len(errs) else None, "found_25ms": float(found), "events": len(true)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", type=Path, required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--stems-npz", type=Path, help="stems.py output for <work>/calibration.wav: also scores the stem detectors")
    ap.add_argument("--write-wav-only", action="store_true", help="only write <work>/calibration.wav (to run stems.py on it)")
    args = ap.parse_args(argv)
    args.work.mkdir(parents=True, exist_ok=True)
    y, truth = synth()
    wav = args.work / "calibration.wav"
    write_wav(wav, y)
    if args.write_wav_only:
        print(wav)
        return 0
    lib = librosa_features.compute(librosa_features.decode_mono(wav))
    plug = extract_features.extract(args.build, wav, args.work / "calibration.features.json")
    every = sorted(t for v in truth.values() for t in v)
    result = {"librosa": {}, "plugin": {}}
    # Each librosa detector against the events it is meant to see.
    targets = {"full": every, "perc": truth["kick"] + truth["snare"] + truth["hat"], "harm": truth["tone"],
               "low": truth["kick"], "lowmid": truth["snare"] + truth["tone"], "highmid": truth["snare"] + truth["tone"], "high": truth["hat"] + truth["snare"]}
    for cls, true in targets.items():
        result["librosa"][cls] = score(lib[f"onsets_{cls}"], sorted(true))
    drums = {k: [d["t"] for d in plug["drums"] if d["kind"] == k] for k in ("kick", "snare", "hat", "perc")}
    result["plugin"]["kick"] = score(drums["kick"], truth["kick"])
    result["plugin"]["snare"] = score(drums["snare"], truth["snare"])
    result["plugin"]["hat"] = score(drums["hat"], truth["hat"])
    result["plugin"]["lead_or_bass_note"] = score([n["t"] for n in plug["lead"] + plug["bass"]], truth["tone"])
    for b in plug["bands"]:
        result["plugin"][f"band_{b['name']}"] = score([o["t"] for o in b["onsets"]], every)
    # Classification: of the plugin's drum events within 25 ms of a true event, which class did it give each kind?
    confusion = {}
    for kind in ("kick", "snare", "hat", "tone"):
        row = {}
        for d in plug["drums"]:
            if any(abs(d["t"] - t) <= 25 for t in truth[kind]):
                row[d["kind"]] = row.get(d["kind"], 0) + 1
        confusion[kind] = row
    result["plugin_drum_confusion"] = confusion
    if args.stems_npz:
        import numpy as _np  # noqa: PLC0415
        stems = _np.load(args.stems_npz)
        stem_targets = {"stem_drums": truth["kick"] + truth["snare"] + truth["hat"], "stem_bass": truth["kick"] + truth["tone"],
                        "stem_vocals": truth["tone"], "stem_other": truth["tone"]}
        for cls, true in stem_targets.items():
            result["librosa"][cls] = score(stems[f"onsets_{cls}"], sorted(true))
    # A detector the synthetic signal cannot exercise (no bass line or voice in it: stem_bass, stem_vocals) finds few
    # events; its bias is assumed to be the median of the measured ones (same onset method), and marked as assumed.
    measured = {cls: v["median_ms"] for cls, v in result["librosa"].items() if v["median_ms"] is not None and v["found_25ms"] >= 0.8}
    fallback = float(np.median(list(measured.values())))
    result["bias_ms"] = {cls: measured.get(cls, fallback) for cls in result["librosa"]}
    result["bias_assumed"] = sorted(cls for cls in result["librosa"] if cls not in measured)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
