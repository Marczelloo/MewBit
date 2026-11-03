"""Stage 1 pipeline: corpus .osz files -> per-level human and algorithm metrics in mapping-analysis/shared/data/.

    python3 -I pipeline/run_pipeline.py --maps <folder with .osz> [--corpus shared/corpus.csv] [--work data]
                                        [--build <java classes dir>] [--only <set_id,...>] [--jobs 4]

Per beatmapset of the corpus (shared/corpus.csv, from corpus/select_corpus.py):
  1. finds its .osz in --maps, reads it as data (osu_format.read_osz), picks the difficulty chosen for each level;
  2. copies the audio out, runs the plugin DSP (features JSON v2) and the librosa features on it (cached in --work);
  3. dumps the generator's own analysis (beat grid, phrases, leaders) and, for test songs, generates its charts;
  4. measures every human chart and, for test songs, every algorithm chart on the human map's timing grid.
Outputs, one folder per level so a level's analysis never needs another level's files:
  shared/data/<level>/human/<set>.json, shared/data/<level>/algo/<set>.json, shared/data/<level>/slots/<who>_<set>.npz
  shared/data/songs/<set>.json  (level-independent: alignment check, structure, the algorithm's beat tracking)
  shared/cross/<set>.json        (charts of every level of the set, for stage 3 only)
"""

from __future__ import annotations

import argparse
import csv
import fcntl
import json
import re
import subprocess
import sys
import traceback
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # mapping-analysis/
for sub in ("osu", "metrics", "audio"):
    sys.path.insert(0, str(HERE / sub))

import numpy as np  # noqa: E402

import audio_metrics as am  # noqa: E402
import chart_metrics as cm  # noqa: E402
import extract_features  # noqa: E402
import librosa_features  # noqa: E402
from osu_format import TimingGrid, copy_audio, main_bpm, parse_osu, read_osz, shifted  # noqa: E402

LEVELS = ("easy", "normal", "hard")


def osz_index(maps: Path) -> dict[int, Path]:
    """set id -> .osz path: from the file name's leading number, else from the BeatmapSetID inside."""
    index: dict[int, Path] = {}
    for p in sorted(maps.glob("*.osz")):
        m = re.match(r"^(\d+)", p.name)
        if m:
            index.setdefault(int(m.group(1)), p)
            continue
        try:
            osu, _ = read_osz(p)
            for text in osu.values():
                sid = parse_osu(text).metadata.get("BeatmapSetID", "")
                if sid.isdigit():
                    index.setdefault(int(sid), p)
                    break
        except Exception:  # noqa: BLE001 - a broken archive is reported by the caller as missing
            pass
    return index


def pick(beatmaps: list, beatmap_id: str, version: str):
    if beatmap_id:
        for bm in beatmaps:
            if bm.beatmap_id == int(beatmap_id):
                return bm
    for bm in beatmaps:
        if version and bm.version == version:
            return bm
    return None


def red_lines(bm) -> list[tuple[int, float, int]]:
    return [(round(p.t), round(p.beat_length, 4), p.meter) for p in bm.timing if p.uninherited and p.beat_length > 0]


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, default=_jsonable))


def _jsonable(x):
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return float(x)
    if isinstance(x, np.ndarray):
        return x.tolist()
    if isinstance(x, (set, tuple)):
        return list(x)
    raise TypeError(type(x))


def measure(notes, grid, breaks, npz, events, bias, kind: str = "human") -> tuple[dict, dict]:
    span = (float(notes[0].t), float(max(n.end if n.hold else n.t for n in notes)) + 1)
    out = cm.chart_metrics(notes, grid, breaks, kind=kind)
    out["alignment"] = am.onset_alignment(notes, npz, bias)
    out["plugin_events"] = am.plugin_coincidence(notes, events, span)
    out["repetition"] = am.repetition_metrics(notes, grid, npz, span, kind=kind)
    bars = am.bar_features(grid, npz, span)
    boundaries = am.section_boundaries(bars)
    out["sections"] = am.section_metrics(notes, grid, bars, boundaries)
    out["rest_context"] = am.rest_context(notes, grid, npz, [float(bars["edges"][b]) for b in boundaries])
    out["hand_by_class"] = am.hand_by_class(notes, events)
    slots = am.slot_table(notes, grid, npz, events, span, bias, kind=kind)
    return out, slots


def process(row: dict, args) -> dict:
    sid = int(row["set_id"])
    status = {"set_id": sid, "levels": {}, "errors": []}
    osz = args.index.get(sid)
    if osz is None:
        status["errors"].append("osz missing")
        return status
    texts, members = read_osz(osz)
    beatmaps = [parse_osu(t) for t in texts.values()]
    chosen = {}
    for level in LEVELS:
        bid, ver = row.get(f"{level}_beatmap_id", ""), row.get(f"{level}_version", "")
        if not (bid or ver):
            continue
        bm = pick(beatmaps, bid, ver)
        if bm is None:
            status["errors"].append(f"{level}: difficulty {bid or ver} not in the archive")
        elif bm.mode != 3 or bm.keys != 4:
            status["errors"].append(f"{level}: not a 4K mania difficulty (mode {bm.mode}, keys {bm.keys})")
        else:
            chosen[level] = bm
    if not chosen:
        return status
    audio_names = {bm.audio_filename for bm in chosen.values()}
    if len(audio_names) > 1:
        status["errors"].append(f"difficulties use different audio files: {sorted(audio_names)}")
    ref = max(chosen.values(), key=lambda bm: len(bm.notes))
    audio = copy_audio(osz, members, ref.audio_filename, args.work / "audio")
    if audio is None:
        status["errors"].append("audio missing or not allowed")
        return status
    feats_path = args.work / "features" / f"{sid}.json"
    if not feats_path.exists():
        extract_features.extract(args.build, audio, feats_path)
    features = json.loads(feats_path.read_text())
    npz_path = args.work / "librosa" / f"{sid}.npz"
    if not npz_path.exists():
        npz_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(npz_path, **librosa_features.compute(librosa_features.decode_mono(audio)))
    npz = dict(np.load(npz_path))
    if args.stems_python:
        stems_path = args.work / "stems" / f"{sid}.npz"
        if not stems_path.exists():
            # One separation at a time: TensorFlow takes several GB per song, and parallel jobs ran out of memory.
            stems_path.parent.mkdir(parents=True, exist_ok=True)
            with open(stems_path.parent / ".lock", "w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if not stems_path.exists():
                    subprocess.run([str(args.stems_python), "-I", str(HERE / "audio" / "stems.py"), "--models", str(args.stems_models), str(audio), str(stems_path)],
                                   check=True, capture_output=True)
        npz.update({k: v for k, v in np.load(stems_path).items() if "stem_" in k})
    events = am.plugin_events(features)
    bias = args.bias
    analysis_path = args.work / "algo_analysis" / f"{sid}.json"
    if not analysis_path.exists():
        subprocess.run(["node", str(HERE / "algo" / "dump_analysis.js"), str(feats_path), str(analysis_path)], check=True, capture_output=True)
    analysis = json.loads(analysis_path.read_text())

    # The osu! timeline and the decoded audio differ by tens of ms (MP3 decoder delay, the mapper's offset): one shift
    # per song, fitted on every chosen difficulty's notes, moves the human maps onto the audio timeline, where the
    # algorithm's charts and every audio feature already are.
    offset = am.estimate_offset([n.t for bm in chosen.values() for n in bm.notes], npz, events, bias)
    chosen = {lvl: shifted(bm, offset["offset_ms"]) for lvl, bm in chosen.items()}
    ref = max(chosen.values(), key=lambda bm: len(bm.notes))

    # Timing consistency across the chosen difficulties (the ranking criteria want one timing per set).
    reds = {lvl: red_lines(bm) for lvl, bm in chosen.items()}
    timing_consistent = len({json.dumps(r) for r in reds.values()}) == 1
    ref_grid = TimingGrid(ref.timing)
    ref_notes = cm.from_osu(ref.notes)
    span = (float(ref_notes[0].t), float(max(n.end if n.hold else n.t for n in ref_notes)) + 1)
    song = {
        "set_id": sid, "audio": audio.name, "audio_names": sorted(audio_names), "timing_consistent": timing_consistent,
        "timeline_offset": offset,
        "variable_bpm": ref_grid.is_variable, "meters": sorted(ref_grid.meters), "red_lines": len(ref_grid.reds),
        "main_bpm": main_bpm(ref_grid, *span), "duration_ms": float(npz["duration_ms"]), "reference_level": next(l for l, b in chosen.items() if b is ref),
        "alignment_reference": am.onset_alignment(ref_notes, npz, bias),
        "algo_beat_tracking": am.beat_tracking(analysis, ref_grid, span),
        "algo_tempo": analysis.get("tempo"), "algo_vocal": analysis.get("vocal"),
        "algo_leaders": [p["leader"] for p in analysis.get("phrases", [])],
        "structure_boundaries_ms": [], "split": row.get("split"), "genre": row.get("genre"),
    }
    bars = am.bar_features(ref_grid, npz, span)
    song["structure_boundaries_ms"] = [float(bars["edges"][b]) for b in am.section_boundaries(bars)] if "chroma" in bars else []
    write_json(args.shared / "data" / "songs" / f"{sid}.json", song)

    cross = {"set_id": sid, "split": row.get("split"), "human": {}, "algo": {}}
    test = row.get("split") == "test"
    algo_dir = args.work / "algo_charts"
    if test:
        missing = [l for l in LEVELS if not (algo_dir / l / f"{sid}.json").exists()]
        if missing:
            subprocess.run(["node", str(HERE / "algo" / "generate_charts.js"), str(feats_path), str(algo_dir), "--levels", ",".join(missing), "--key", f"osu:{sid}"],
                           check=True, capture_output=True)
    for level in LEVELS:
        lvl_out = args.shared / "data" / level
        if level in chosen:
            bm = chosen[level]
            grid = TimingGrid(bm.timing)
            notes = cm.from_osu(bm.notes)
            metrics, slots = measure(notes, grid, bm.breaks, npz, events, bias)
            metrics.update(set_id=sid, beatmap_id=bm.beatmap_id, version=bm.version, creator=bm.metadata.get("Creator"),
                           od=bm.difficulty.get("OverallDifficulty"), hp=bm.difficulty.get("HPDrainRate"), stars=row.get(f"{level}_stars"))
            write_json(lvl_out / "human" / f"{sid}.json", metrics)
            (lvl_out / "slots").mkdir(parents=True, exist_ok=True)
            np.savez_compressed(lvl_out / "slots" / f"human_{sid}.npz", **slots)
            cross["human"][level] = [[n.t, n.lane, n.end] for n in notes]
            status["levels"][level] = "human"
        if test:
            data = json.loads((algo_dir / level / f"{sid}.json").read_text())
            chart = data.get("chart")
            if chart is None:
                write_json(lvl_out / "algo" / f"{sid}.json", {"set_id": sid, "valid": False, "reason": "not chartable"})
                continue
            grid = TimingGrid(chosen[level].timing) if level in chosen else ref_grid
            notes = cm.from_mewbeat(chart)
            metrics, slots = measure(notes, grid, [], npz, events, bias, kind="algo")
            if level in chosen:
                metrics["versus_human"] = am.versus_human(notes, cm.from_osu(chosen[level].notes), grid)
            metrics.update(set_id=sid, generator_version=data["meta"]["generatorVersion"], algo_stars=chart.get("stars"),
                           grid_from=level if level in chosen else song["reference_level"])
            write_json(lvl_out / "algo" / f"{sid}.json", metrics)
            (lvl_out / "slots").mkdir(parents=True, exist_ok=True)
            np.savez_compressed(lvl_out / "slots" / f"algo_{sid}.npz", **slots)
            cross["algo"][level] = [[n.t, n.lane, n.end] for n in notes]
            status["levels"][level] = status["levels"].get(level, "") + "+algo"
    write_json(args.shared / "cross" / f"{sid}.json", cross)
    return status


def run_one(row, args):
    try:
        return process(row, args)
    except Exception as e:  # noqa: BLE001 - one bad set must not stop the corpus
        return {"set_id": row.get("set_id"), "errors": [f"{type(e).__name__}: {e}", traceback.format_exc(limit=3)]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--maps", type=Path, required=True)
    ap.add_argument("--corpus", type=Path, default=ROOT / "shared" / "corpus.csv")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--build", type=Path, default=ROOT / "data" / "dspbuild")
    ap.add_argument("--bias", type=Path, default=ROOT / "shared" / "onset_bias.json")
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--stems-python", type=Path, help="python of the Spleeter environment (audio/stems.py); omit to skip stems")
    ap.add_argument("--stems-models", type=Path, help="folder containing Spleeter's 4stems/ weights")
    args = ap.parse_args(argv)
    if not (args.build / "FeatureDump.class").exists():
        extract_features.compile_dsp(args.build)
    args.bias = json.loads(args.bias.read_text())["bias_ms"] if args.bias.exists() else {}
    args.index = osz_index(args.maps)
    with open(args.corpus, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if not r["set_id"].startswith("#")]
    if args.only:
        keep = set(args.only.split(","))
        rows = [r for r in rows if r["set_id"] in keep]
    if args.jobs > 1:
        with ProcessPoolExecutor(args.jobs) as pool:
            results = list(pool.map(run_one, rows, [args] * len(rows)))
    else:
        results = [run_one(r, args) for r in rows]
    log = args.shared / "data" / "pipeline_status.json"
    write_json(log, results)
    bad = [r for r in results if r.get("errors")]
    print(f"{len(results)} sets, {len(bad)} with problems (see {log})")
    for r in bad[:20]:
        print(" ", r["set_id"], r["errors"][0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
