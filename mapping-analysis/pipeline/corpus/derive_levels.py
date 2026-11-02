"""Evidence for the star-rating ranges of the game's three levels (the decision is written to shared/levels.md/.json).

    python3 -I derive_levels.py --candidates data/corpus/candidates.json --out data/corpus/levels_evidence.json

Difficulty names are not used to assign levels (they mislead), only as a weak signal of where mappers themselves put
"Easy", "Normal" and "Hard". The script reports, over every Ranked 4K difficulty:
  * star-rating quantiles per name class, and density (notes per second of hit time) per star-rating band;
  * for each pair of neighbouring name classes, the star rating that best separates them (Youden's J);
  * for candidate range sets (AIMod's 2.0 / 2.7 / 4.0 and the data-driven cut points), how many sets have a
    difficulty in each range and in all three: the corpus needs at least 60 sets per level.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

NAME_CLASSES = [
    ("easy", r"\b(easy|ez|beginner|basic|novice)\b"),
    ("normal", r"\b(normal|nm|light|standard|advanced)\b"),
    ("hard", r"\b(hard|hd|hyper)\b"),
    ("insane", r"\b(insane|mx|maximum|another|crazy)\b"),
    ("expert", r"\b(expert|shd|sc|extra|extreme|ex|master|black another|legendary)\b"),
]
AIMOD = {"easy": (0.0, 2.0), "normal": (2.0, 2.7), "hard": (2.7, 4.0)}


def name_class(version: str) -> str | None:
    v = (version or "").lower()
    hits = [c for c, rx in NAME_CLASSES if re.search(rx, v)]
    return hits[0] if len(hits) == 1 else None


def youden_cut(lo: np.ndarray, hi: np.ndarray) -> float | None:
    if len(lo) < 20 or len(hi) < 20:
        return None
    grid = np.arange(0.5, 8.0, 0.05)
    best, cut = -1.0, None
    for c in grid:
        j = (lo < c).mean() + (hi >= c).mean() - 1
        if j > best:
            best, cut = j, float(round(c, 2))
    return cut


def coverage(cands: list[dict], ranges: dict[str, tuple[float, float]]) -> dict:
    per = {k: 0 for k in ranges}
    full = 0
    for s in cands:
        have = {k for k, (a, b) in ranges.items() if any(d["stars"] is not None and a <= d["stars"] < b for d in s["diffs"])}
        for k in have:
            per[k] += 1
        full += len(have) == len(ranges)
    return {"sets_per_level": per, "sets_with_all_levels": full, "sets": len(cands)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    cands = [s for s in json.loads(args.candidates.read_text()) if s.get("status") == "ranked" and s["diffs"]]
    diffs = [d for s in cands for d in s["diffs"] if d.get("stars") is not None]
    by_class: dict[str, list[float]] = {c: [] for c, _ in NAME_CLASSES}
    unnamed = 0
    for d in diffs:
        c = name_class(d["version"])
        if c:
            by_class[c].append(d["stars"])
        else:
            unnamed += 1
    evidence: dict = {"diffs": len(diffs), "sets": len(cands), "diffs_without_clear_name_class": unnamed, "name_classes": {}}
    for c, vals in by_class.items():
        a = np.array(vals)
        evidence["name_classes"][c] = {"n": len(a), **({f"p{q}": float(np.quantile(a, q / 100)) for q in (5, 25, 50, 75, 95)} if len(a) else {})}
    cuts = {}
    for lo, hi in (("easy", "normal"), ("normal", "hard"), ("hard", "insane")):
        cuts[f"{lo}|{hi}"] = youden_cut(np.array(by_class[lo]), np.array(by_class[hi]))
    evidence["youden_cuts"] = cuts
    # Density by star band (what a range means to a player of this game).
    bands = {}
    for a in np.arange(0.0, 6.0, 0.5):
        sel = [d for d in diffs if a <= d["stars"] < a + 0.5 and d.get("hit_length") and d.get("notes") is not None]
        if len(sel) >= 10:
            nps = np.array([(d["notes"] + (d["holds"] or 0)) / d["hit_length"] for d in sel])
            bands[f"{a:.1f}-{a + 0.5:.1f}"] = {"n": len(sel), "nps_p10": float(np.quantile(nps, 0.1)), "nps_p50": float(np.median(nps)), "nps_p90": float(np.quantile(nps, 0.9))}
    evidence["nps_by_star_band"] = bands
    variants = {"aimod": AIMOD}
    if all(cuts.get(k) for k in ("easy|normal", "normal|hard", "hard|insane")):
        e, n, h = cuts["easy|normal"], cuts["normal|hard"], cuts["hard|insane"]
        variants["youden"] = {"easy": (0.0, e), "normal": (e, n), "hard": (n, h)}
    evidence["coverage"] = {name: {"ranges": r, **coverage(cands, r)} for name, r in variants.items()}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(evidence, indent=2))
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
