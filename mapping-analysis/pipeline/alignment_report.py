"""Checks that notes and audio share one timeline, on the songs processed so far (shared/alignment.md).

    python3 -I pipeline/alignment_report.py [--shared shared] [--work data] [--sample 15]

For every song: the reference difficulty's notes against librosa onsets (corrected by shared/onset_bias.json):
share within 25 ms and median signed offset; the audio codec and start padding (ffprobe), since an MP3 decoder that
does not trim the encoder delay shifts everything by ~25 ms. A song is flagged when its median offset is beyond
+-8 ms or under 70 % of its notes sit on an onset. The --sample songs with the most notes get a per-detector table
so the report shows the check on a concrete sample, not only an aggregate.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "metrics"))
import audio_metrics as am  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FLAG_OFFSET_MS = 8.0  # |median signed offset| of the notes on percussive onsets, after the correction
FLAG_SHARE = 0.40  # share of notes within 25 ms of a percussive onset (full-mix onsets are too sparse in dense mixes)
FLAG_AGREEMENT_MS = 10.0  # the librosa and plugin offset fits disagree by more than this
FLAG_DRIFT_MS = 8.0  # the offset fitted on the second half of the notes differs from the first half's by more than this


def drift(shared: Path, work: Path, sid: int, bias: dict) -> dict:
    """Offsets fitted separately on the first and the second half of the reference chart's (already shifted) notes."""
    cross = json.loads((shared / "cross" / f"{sid}.json").read_text())
    song = json.loads((shared / "data" / "songs" / f"{sid}.json").read_text())
    notes = cross["human"].get(song["reference_level"]) or next(iter(cross["human"].values()))
    times = np.array(sorted({n[0] for n in notes}), dtype=float)
    perc = am.corrected_onsets(np.load(work / "librosa" / f"{sid}.npz"), "perc", bias)
    half = len(times) // 2
    a, _, _ = am._fit_lag(perc, times[:half])
    b, _, _ = am._fit_lag(perc, times[half:])
    return {"first_half_ms": round(a, 1), "second_half_ms": round(b, 1), "drift_ms": round(b - a, 1)}


def probe(audio: Path) -> dict:
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,start_time,sample_rate:stream_tags=encoder",
                              "-of", "json", str(audio)], check=True, capture_output=True, text=True).stdout
        s = (json.loads(out).get("streams") or [{}])[0]
        return {"codec": s.get("codec_name"), "start_time": s.get("start_time"), "sample_rate": s.get("sample_rate")}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--sample", type=int, default=15)
    ap.add_argument("--bias", type=Path, default=ROOT / "shared" / "onset_bias.json")
    args = ap.parse_args(argv)
    bias = json.loads(args.bias.read_text())["bias_ms"]
    songs = [json.loads(p.read_text()) for p in sorted((args.shared / "data" / "songs").glob("*.json"))]
    rows = []
    for s in songs:
        a = s["alignment_reference"]["perc"]
        o = s.get("timeline_offset", {})
        rows.append({"set_id": s["set_id"], "share": a["share"], "full_share": s["alignment_reference"]["full"]["share"],
                     "median_ms": a["median_signed_ms"], "no_sound": s["alignment_reference"]["no_sound_share"],
                     "variable_bpm": s["variable_bpm"], "timing_consistent": s["timing_consistent"], "offset_ms": o.get("offset_ms"),
                     "offset_share": o.get("share_at_offset"), "agreement_ms": o.get("agreement_ms"),
                     **drift(args.shared, args.work, s["set_id"], bias), **probe(args.work / "audio" / s["audio"])})
    flagged = [r for r in rows if r["median_ms"] is None or abs(r["median_ms"]) > FLAG_OFFSET_MS or r["share"] < FLAG_SHARE
               or abs(r["drift_ms"]) > FLAG_DRIFT_MS or (r["agreement_ms"] or 0) > FLAG_AGREEMENT_MS]
    med = sorted(r["median_ms"] for r in rows if r["median_ms"] is not None)
    lines = ["# Dopasowanie nut do audio", "",
             f"Utwory: {len(rows)}. Oznaczone ({FLAG_SHARE:.0%} > chwil na onsecie perkusyjnym w ±25 ms, |mediana| > {FLAG_OFFSET_MS} ms, "
             f"dryf > {FLAG_DRIFT_MS} ms między połowami utworu lub niezgodność z pluginem > {FLAG_AGREEMENT_MS} ms): {len(flagged)}.", "",
             f"Udział chwil dyfficulty referencyjnej w ±25 ms od onsetu perkusyjnego: p10 {sorted(r['share'] for r in rows)[len(rows) // 10]:.2f}, "
             f"p50 {sorted(r['share'] for r in rows)[len(rows) // 2]:.2f}; pełnego miksu: p50 {sorted(r['full_share'] for r in rows)[len(rows) // 2]:.2f} "
             "(detektor pełnego miksu w gęstych utworach wykrywa mało onsetów, więc do oceny dopasowania służy perkusyjny).", ""]
    offs = sorted(r["offset_ms"] for r in rows if r["offset_ms"] is not None)
    agr = sorted(r["agreement_ms"] for r in rows if r["agreement_ms"] is not None)
    dr = sorted(abs(r["drift_ms"]) for r in rows)
    pick = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
    lines += [f"Przesunięcie osi osu! → audio (dopasowane na utwór): p10 {pick(offs, 0.1)} ms, p50 {pick(offs, 0.5)} ms, p90 {pick(offs, 0.9)} ms, "
              f"min {offs[0] if offs else None}, max {offs[-1] if offs else None}.",
              f"Zgodność z niezależnym dopasowaniem na onsetach pluginu (lowmid): p50 {pick(agr, 0.5)} ms, p90 {pick(agr, 0.9)} ms.",
              f"|Dryf| między połowami utworu: p50 {pick(dr, 0.5)} ms, p90 {pick(dr, 0.9)} ms, max {dr[-1] if dr else None} ms.", ""]
    if med:
        q = lambda p: med[min(len(med) - 1, int(p * len(med)))]
        lines.append(f"Mediana przesunięcia (onset − nuta) po korekcie detektora: p10 {q(0.1):.1f} ms, p50 {q(0.5):.1f} ms, p90 {q(0.9):.1f} ms.")
    by_codec = {}
    for r in rows:
        by_codec.setdefault(r.get("codec"), []).append(r["median_ms"])
    lines += ["", "| kodek | utwory | mediana przesunięcia |", "|---|---|---|"]
    for codec, vals in sorted(by_codec.items(), key=lambda kv: str(kv[0])):
        v = sorted(x for x in vals if x is not None)
        lines.append(f"| {codec} | {len(vals)} | {v[len(v) // 2]:.1f} ms |" if v else f"| {codec} | {len(vals)} | — |")
    lines += ["", "## Oznaczone", "", "| set | udział na onsecie perk. | mediana ms | bez dźwięku | przesunięcie | zgodność | dryf (1. → 2. połowa) | kodek | start | zmienne BPM | spójny timing |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in flagged:
        lines.append(f"| {r['set_id']} | {r['share']:.2f} | {r['median_ms'] and round(r['median_ms'], 1)} | {r['no_sound']:.2f} | {r['offset_ms']} | {r['agreement_ms']} | "
                     f"{r['first_half_ms']} → {r['second_half_ms']} | {r.get('codec')} | {r.get('start_time')} | {r['variable_bpm']} | {r['timing_consistent']} |")
    sample = sorted(songs, key=lambda s: -s["alignment_reference"]["full"]["share"])[: args.sample]
    lines += ["", f"## Próbka ({len(sample)} utworów): udział chwil w ±25 ms od onsetu wg detektora", "",
              "| set | full | perc | harm | low | lowmid | highmid | high |", "|---|---|---|---|---|---|---|---|"]
    for s in sample:
        a = s["alignment_reference"]
        lines.append(f"| {s['set_id']} | " + " | ".join(f"{a[c]['share']:.2f}" for c in ("full", "perc", "harm", "low", "lowmid", "highmid", "high")) + " |")
    out = args.shared / "alignment.md"
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines[2:12]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
