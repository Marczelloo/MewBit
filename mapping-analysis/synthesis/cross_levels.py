"""Stage 3: how charts of one song change between levels, for humans and for the generator.

    python3 -I synthesis/cross_levels.py [--shared shared] [--work data] [--out synthesis/out]

For every set with charts on two levels (human: the corpus' full sets; generator: the 20 test songs), and for each pair
Hard -> Normal and Normal -> Easy (and Hard -> Easy):
  * nesting: the share of the lower level's moments that the higher level also plays (within 25 ms), the share of the
    higher level's moments the lower one keeps, and lane agreement on shared moments;
  * what stays and what goes, by the grid position of the higher level's moment (downbeat, beat, 1/2, 1/4, finer,
    triplet), by chords, holds, and by the plugin event under it;
  * new rhythm: lower-level moments the higher level does not have (a simplification that moves or adds notes);
  * how holds and chords change (a chord kept as a single note, a stream replaced by a hold).
Everything is measured on the human map's grid of that set (the timing is identical across the set's levels), on the
audio timeline. Output: one CSV per pair and source, and a summary JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "pipeline" / "osu"), str(ROOT / "pipeline" / "metrics")]
from osu_format import TimingGrid, parse_osu, read_osz, shifted  # noqa: E402
import chart_metrics as cm  # noqa: E402
import audio_metrics as am  # noqa: E402

LEVELS = ("easy", "normal", "hard")
PAIRS = (("hard", "normal"), ("normal", "easy"), ("hard", "easy"))
TOL = 25.0


def position_class(grid, t: float, tol: float) -> str:
    d = grid.snap(t, tol)
    if d == 1:
        return "downbeat" if grid.is_downbeat(t, tol) else "beat"
    return {2: "1/2", 4: "1/4", 8: "1/8", 16: "1/16", 3: "triplet", 6: "triplet", 12: "triplet"}.get(d, "off")


def grid_of(row: dict, song: dict, osz_dir: Path) -> TimingGrid:
    texts, _ = read_osz(osz_dir / f"{row['set_id']}.osz")
    bms = {bm.beatmap_id: bm for bm in map(parse_osu, texts.values())}
    for level in ("hard", "normal", "easy"):
        bid = row.get(f"{level}_beatmap_id")
        if bid and int(bid) in bms:
            return TimingGrid(shifted(bms[int(bid)], song["timeline_offset"]["offset_ms"]).timing)
    raise ValueError("no chosen difficulty in the archive")


def moments(notes) -> list[list]:
    out = []
    for n in sorted(notes, key=lambda n: (n[0], n[1])):
        if out and out[-1][0][0] == n[0]:
            out[-1].append(n)
        else:
            out.append([n])
    return out


def compare(hi_notes, lo_notes, grid, kind: str, events: dict) -> dict:
    tol = cm.tolerance_of(grid, kind)
    H, L = moments(hi_notes), moments(lo_notes)
    ht = np.array([m[0][0] for m in H], float)
    lt = np.array([m[0][0] for m in L], float)
    if len(ht) == 0 or len(lt) == 0:
        return {}
    d_lo = np.abs(am.nearest_dist(ht, lt))  # each lower moment -> nearest higher moment
    d_hi = np.abs(am.nearest_dist(lt, ht))
    lo_in_hi = d_lo <= TOL
    hi_kept = d_hi <= TOL
    lane_same = []
    for k in np.where(lo_in_hi)[0]:
        j = int(np.argmin(np.abs(ht - lt[k])))
        lane_same.append(bool({n[1] for n in L[k]} & {n[1] for n in H[j]}))
    # What the lower level keeps of the higher one, by position and kind of the higher moment.
    keep = defaultdict(lambda: [0, 0])
    ev_t = {c: np.sort(e[:, 0]) for c, e in events.items() if len(e)}
    for j, m in enumerate(H):
        t = m[0][0]
        tags = [f"pos:{position_class(grid, t, tol(t))}", "chord" if len(m) >= 2 else "single"]
        if any(n[2] is not None for n in m):
            tags.append("hold")
        for c in ("kick", "snare", "hat", "bass", "lead"):
            if c in ev_t and np.min(np.abs(ev_t[c] - t)) <= TOL:
                tags.append(f"ev:{c}")
        for tag in tags:
            keep[tag][0] += int(hi_kept[j])
            keep[tag][1] += 1
    # Lower-level moments the higher level does not have: their position.
    new_pos = Counter(position_class(grid, lt[k], tol(lt[k])) for k in np.where(~lo_in_hi)[0])
    # Chords of the higher level that the lower level keeps as a single note, and holds that appear.
    chord_kept_single = chord_kept_chord = 0
    for j, m in enumerate(H):
        if len(m) >= 2 and hi_kept[j]:
            k = int(np.argmin(np.abs(lt - ht[j])))
            if len(L[k]) >= 2:
                chord_kept_chord += 1
            else:
                chord_kept_single += 1
    holds_hi = sum(1 for n in hi_notes if n[2] is not None)
    holds_lo = sum(1 for n in lo_notes if n[2] is not None)
    return {
        "hi_moments": len(H), "lo_moments": len(L),
        "lo_share_of_hi": len(L) / len(H),
        "lo_in_hi_share": float(lo_in_hi.mean()),  # nesting: the lower level is a subset of the higher one
        "hi_kept_share": float(hi_kept.mean()),
        "lane_agreement_on_shared": float(np.mean(lane_same)) if lane_same else None,
        "keep_by": {k: v[0] / v[1] for k, v in keep.items() if v[1] >= 5},
        "keep_counts": {k: v[1] for k, v in keep.items()},
        "new_by_position": {k: v / max(1, int((~lo_in_hi).sum())) for k, v in new_pos.items()},
        "new_share": float((~lo_in_hi).mean()),
        "chords_kept_as_chord_share": chord_kept_chord / (chord_kept_chord + chord_kept_single) if (chord_kept_chord + chord_kept_single) else None,
        "hold_share_hi": holds_hi / max(1, len(hi_notes)), "hold_share_lo": holds_lo / max(1, len(lo_notes)),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--work", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "synthesis" / "out")
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    corpus = {r["set_id"]: r for r in csv.DictReader(open(args.shared / "corpus.csv", encoding="utf-8"))}
    results = {(src, hi, lo): [] for src in ("human", "algo") for hi, lo in PAIRS}
    for p in sorted((args.shared / "cross").glob("*.json")):
        cross = json.loads(p.read_text())
        sid = str(cross["set_id"])
        song = json.loads((args.shared / "data" / "songs" / f"{sid}.json").read_text())
        grid = grid_of(corpus[sid], song, args.work / "osz")
        features = json.loads((args.work / "features" / f"{sid}.json").read_text())
        events = am.plugin_events(features)
        for src in ("human", "algo"):
            charts = cross.get(src, {})
            for hi, lo in PAIRS:
                if hi in charts and lo in charts:
                    r = compare(charts[hi], charts[lo], grid, src, events)
                    if r:
                        r.update(set_id=sid, genre=corpus[sid]["genre"], split=corpus[sid]["split"], bpm=float(corpus[sid]["bpm"]))
                        results[(src, hi, lo)].append(r)
    summary = {}
    for (src, hi, lo), rows in results.items():
        key = f"{src}:{hi}->{lo}"
        if not rows:
            continue
        def q(vals):
            vals = [v for v in vals if v is not None]
            return {"p10": float(np.quantile(vals, 0.1)), "p50": float(np.median(vals)), "p90": float(np.quantile(vals, 0.9)), "n": len(vals)} if vals else None
        tags = sorted({t for r in rows for t in r["keep_by"]})
        summary[key] = {
            "sets": len(rows),
            **{k: q([r[k] for r in rows]) for k in ("lo_share_of_hi", "lo_in_hi_share", "hi_kept_share", "lane_agreement_on_shared", "new_share",
                                                   "chords_kept_as_chord_share", "hold_share_hi", "hold_share_lo")},
            "keep_by": {t: q([r["keep_by"].get(t) for r in rows]) for t in tags},
            "new_by_position": {t: q([r["new_by_position"].get(t, 0.0) for r in rows]) for t in sorted({t for r in rows for t in r["new_by_position"]})},
        }
        flat = []
        for r in rows:
            row = {k: v for k, v in r.items() if not isinstance(v, dict)}
            row.update({f"keep.{k}": v for k, v in r["keep_by"].items()})
            row.update({f"new.{k}": v for k, v in r["new_by_position"].items()})
            flat.append(row)
        cols = list(dict.fromkeys(k for r in flat for k in r))
        with open(args.out / f"{src}_{hi}_{lo}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(flat)
    (args.out / "cross_levels_summary.json").write_text(json.dumps(summary, indent=1))
    for key, s in summary.items():
        print(key, "sets", s["sets"], "| lower/higher moments %.2f | lower in higher %.2f | higher kept %.2f | lanes same %.2f | new %.2f" % (
            s["lo_share_of_hi"]["p50"], s["lo_in_hi_share"]["p50"], s["hi_kept_share"]["p50"],
            (s["lane_agreement_on_shared"] or {}).get("p50", float("nan")), s["new_share"]["p50"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
