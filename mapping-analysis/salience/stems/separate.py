"""Split songs into instruments with Demucs. Run with /opt/sep/bin/python.
   separate.py --ids a,b [--device cuda|cpu] [--threads N] [--force]  -> <out>/<id>/<stem>.flac, <out>/timing.jsonl
   Stems are mono 22050 Hz and share one gain, so their levels stay comparable with each other.
"""
import os, json, time, argparse, subprocess
import numpy as np
import soundfile as sf
import torch
import julius
from demucs.pretrained import get_model
from demucs.apply import apply_model

DATA = "/repo/.mewbeat-debug/data/audio"
HD = "/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.pcm.wav"
OUT = "/out/data/stems"
SR_IN, SR_OUT = 44100, 22050


def source(sid):
    if sid == "hd":
        return HD
    for ext in ("mp3", "ogg", "m4a", "wav", "opus"):
        p = f"{DATA}/{sid}.{ext}"
        if os.path.exists(p):
            return p
    raise FileNotFoundError(sid)


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR_IN), "-"],
                         check=True, capture_output=True).stdout
    return torch.from_numpy(np.frombuffer(raw, np.float32).copy()).reshape(-1, 2).T


def separate(model, wav, device):
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-9
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=0, split=True, overlap=0.25, progress=False)[0]
    return out * std + mean


def write(sid, stems, names):
    d = f"{OUT}/{sid}"
    os.makedirs(d, exist_ok=True)
    mono = julius.resample_frac(stems.mean(1), SR_IN, SR_OUT)
    gain = 0.99 / max(float(mono.abs().max()), 1e-6)
    for i, name in enumerate(names):
        sf.write(f"{d}/{name}.flac", (mono[i] * gain).clamp(-1, 1).numpy(), SR_OUT, subtype="PCM_16")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.threads:
        torch.set_num_threads(a.threads)
    model = get_model("htdemucs_6s")
    model.to(a.device).eval()
    os.makedirs(OUT, exist_ok=True)
    for sid in a.ids.split(","):
        if not a.force and os.path.exists(f"{OUT}/{sid}/{model.sources[-1]}.flac"):
            print(sid, "skip", flush=True)
            continue
        wav = decode(source(sid))
        dur = wav.shape[1] / SR_IN
        t0 = time.time()
        stems = separate(model, wav, a.device).cpu()
        sec = time.time() - t0
        write(sid, stems, model.sources)
        peak = torch.cuda.max_memory_allocated() / 2**20 if a.device == "cuda" else 0
        rec = {"id": sid, "device": a.device, "threads": a.threads or torch.get_num_threads(), "dur": round(dur, 1),
               "sec": round(sec, 1), "x_realtime": round(sec / dur, 3), "peak_mb": round(peak)}
        open(f"{OUT}/timing.jsonl", "a").write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)


if __name__ == "__main__":
    main()
