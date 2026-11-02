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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLAG_OFFSET_MS = 8.0
FLAG_SHARE = 0.70


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
    args = ap.parse_args(argv)
    songs = [json.loads(p.read_text()) for p in sorted((args.shared / "data" / "songs").glob("*.json"))]
    rows = []
    for s in songs:
        a = s["alignment_reference"]["full"]
        rows.append({"set_id": s["set_id"], "share": a["share"], "median_ms": a["median_signed_ms"], "no_sound": s["alignment_reference"]["no_sound_share"],
                     "variable_bpm": s["variable_bpm"], "timing_consistent": s["timing_consistent"], **probe(args.work / "audio" / s["audio"])})
    flagged = [r for r in rows if r["median_ms"] is None or abs(r["median_ms"]) > FLAG_OFFSET_MS or r["share"] < FLAG_SHARE]
    med = sorted(r["median_ms"] for r in rows if r["median_ms"] is not None)
    lines = ["# Dopasowanie nut do audio", "", f"Utwory: {len(rows)}. Oznaczone (|mediana| > {FLAG_OFFSET_MS} ms lub < {FLAG_SHARE:.0%} chwil na onsecie): {len(flagged)}.", ""]
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
    lines += ["", "## Oznaczone", "", "| set | udział na onsecie | mediana ms | bez dźwięku | kodek | start | zmienne BPM | spójny timing |", "|---|---|---|---|---|---|---|---|"]
    for r in flagged:
        lines.append(f"| {r['set_id']} | {r['share']:.2f} | {r['median_ms']} | {r['no_sound']:.2f} | {r.get('codec')} | {r.get('start_time')} | {r['variable_bpm']} | {r['timing_consistent']} |")
    sample = sorted(songs, key=lambda s: -s["alignment_reference"]["full"]["share"])[: args.sample]
    lines += ["", f"## Próbka ({len(sample)} utworów): udział chwil w ±25 ms od onsetu wg detektora", "",
              "| set | full | perc | harm | low | lowmid | highmid | high |", "|---|---|---|---|---|---|---|---|"]
    for s in sample:
        a = s["alignment_reference"]
        lines.append(f"| {s['set_id']} | " + " | ".join(f"{a[c]['share']:.2f}" for c in ("full", "perc", "harm", "low", "lowmid", "highmid", "high")) + " |")
    out = args.shared / "alignment.md"
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:4]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
