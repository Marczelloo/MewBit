"""Audio file -> mewbeat features JSON v2, with the plugin's own DSP (compiled from source, unmodified).

    python3 -I extract_features.py --build <classes dir> <audio file> <out.json> [--tier full|light]
    python3 -I extract_features.py --compile --build <classes dir>

The decode goes through ffmpeg to 48 kHz stereo signed 16-bit PCM, which is what lavaplayer hands the plugin;
FeatureDump.java then follows AnalysisWorker.analyze (Downsampler -> FeatureExtractor). The audio file is treated as
data: it is only ever passed to ffmpeg as an input path.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DSP_SOURCES = REPO / "lavalink-plugins" / "mewbeat" / "src" / "main" / "java" / "dev" / "mewbit" / "mewbeat" / "dsp"


def compile_dsp(build: Path) -> None:
    build.mkdir(parents=True, exist_ok=True)
    sources = sorted(str(p) for p in DSP_SOURCES.glob("*.java")) + [str(HERE / "FeatureDump.java")]
    subprocess.run(["javac", "-encoding", "UTF-8", "--release", "17", "-d", str(build), *sources], check=True)


def decode(audio: Path, raw: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(audio),
         "-vn", "-ac", "2", "-ar", "48000", "-f", "s16le", "-acodec", "pcm_s16le", str(raw)],
        check=True,
    )


def extract(build: Path, audio: Path, out: Path, tier: str = "full") -> dict:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "audio.s16le"
        decode(audio, raw)
        env = {k: v for k, v in os.environ.items() if k != "CLASSPATH"}
        subprocess.run(["java", "-Xmx1g", "-cp", str(build), "FeatureDump", str(raw), str(out), tier], check=True, env=env)
    with open(out, encoding="utf-8") as f:
        features = json.load(f)
    if features.get("featuresVersion") != 4:
        raise RuntimeError(f"unexpected featuresVersion {features.get('featuresVersion')}")
    return features


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True, type=Path)
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--tier", default="full", choices=["full", "light"])
    ap.add_argument("audio", nargs="?", type=Path)
    ap.add_argument("out", nargs="?", type=Path)
    args = ap.parse_args(argv)
    if args.compile:
        compile_dsp(args.build)
        if not args.audio:
            return 0
    if not (args.audio and args.out):
        ap.error("audio and out are required")
    if not (args.build / "FeatureDump.class").exists():
        compile_dsp(args.build)
    f = extract(args.build, args.audio, args.out, args.tier)
    print(f"{args.audio.name}: {f['durationMs']} ms, bpm {f['tempo']['bpm']} conf {f['tempo']['confidence']}, "
          f"drums {len(f['drums'])}, bass {len(f['bass'])}, lead {len(f['lead'])}, phrases {len(f['phrases']['list'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
