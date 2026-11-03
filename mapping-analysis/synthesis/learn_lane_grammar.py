"""Stage 6: learn how people lay out lanes, from the human charts of the train songs only.

    python3 -I synthesis/learn_lane_grammar.py --cross RUN/cross --out helpers/mewbeat/charts/laneGrammar.json

A chart is a walk over moments, each a mask of lanes (1-15, bit 0 = lane 0). For every moment we count its mask given
how long ago the last moment was, how many notes it holds and the masks before it, up to three back. Every chart also
counts mirrored, so neither hand is favoured. The generator walks the same table (helpers/mewbeat/charts/lanes.js).

The output is { level: { "gap|size|m3.m2.m1": { mask: count } } }; the order-0 key is "gap|size|". Rare contexts are
left out, which the generator treats as "nothing more is known here" and falls back to a shorter history.
Also prints how often a chord of one level stays a chord on the next, which the chord plan uses.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

LEVELS = ("easy", "normal", "hard")
GAP_LIMITS_MS = (120, 200, 350)  # the classes must match GAP_LIMITS_MS in lanes.js
MAX_ORDER = 3
MIN_TOTAL = {2: 20, 3: 40}
MIN_MASK_SHARE = 0.01


def gap_class(gap_ms: float) -> int:
    for i, limit in enumerate(GAP_LIMITS_MS):
        if gap_ms < limit:
            return i
    return len(GAP_LIMITS_MS)


def mirror(mask: int) -> int:
    return sum(1 << (3 - lane) for lane in range(4) if mask >> lane & 1)


def moments_of(notes: list) -> list[tuple[float, int]]:
    masks: dict[float, int] = defaultdict(int)
    for t, lane, *_ in notes:
        masks[t] |= 1 << int(lane)
    return sorted(masks.items())


def count_walk(moments: list[tuple[float, int]], table: dict, flip: bool) -> None:
    history: list[int] = []
    last_t = None
    for t, raw in moments:
        mask = mirror(raw) if flip else raw
        size = bin(mask).count("1")
        gap = gap_class(t - last_t) if last_t is not None else len(GAP_LIMITS_MS)
        for order in range(0, min(MAX_ORDER, len(history)) + 1):
            tail = history[len(history) - order :]
            table[order][f"{gap}|{size}|{'.'.join(map(str, tail))}"][mask] += 1
        history.append(mask)
        last_t = t


def pruned(table: dict) -> dict:
    out = {}
    for order, contexts in table.items():
        for key, counts in contexts.items():
            total = sum(counts.values())
            if total < MIN_TOTAL.get(order, 1):
                continue
            kept = {m: c for m, c in counts.items() if order < 2 or c / total >= MIN_MASK_SHARE}
            out[key] = {str(m): c for m, c in sorted(kept.items())}
    return out


def chord_keep(hi: list, lo: list) -> dict:
    hi_masks, lo_masks = dict(moments_of(hi)), dict(moments_of(lo))
    c = Counter()
    for t, mask in lo_masks.items():
        if t not in hi_masks:
            continue
        kind = "chord" if bin(hi_masks[t]).count("1") >= 2 else "single"
        c[kind] += 1
        if bin(mask).count("1") >= 2:
            c[kind + "_stays"] += 1
    return c


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cross", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    tables = {level: {order: defaultdict(Counter) for order in range(MAX_ORDER + 1)} for level in LEVELS}
    keep = {"hard->normal": Counter(), "normal->easy": Counter()}
    songs = 0
    for path in sorted(args.cross.glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("split") != "train":
            continue
        songs += 1
        human = data.get("human") or {}
        for level in LEVELS:
            if not human.get(level):
                continue
            moments = moments_of(human[level])
            count_walk(moments, tables[level], False)
            count_walk(moments, tables[level], True)
        for pair, (hi, lo) in {"hard->normal": ("hard", "normal"), "normal->easy": ("normal", "easy")}.items():
            if human.get(hi) and human.get(lo):
                keep[pair] += chord_keep(human[hi], human[lo])

    grammar = {level: pruned(tables[level]) for level in LEVELS}
    args.out.write_text(json.dumps(grammar, separators=(",", ":")) + "\n")
    print("songs", songs, "bytes", args.out.stat().st_size, {level: len(g) for level, g in grammar.items()})
    for pair, c in keep.items():
        print(pair, "chord stays", round(c["chord_stays"] / max(1, c["chord"]), 3), "single becomes chord", round(c["single_stays"] / max(1, c["single"]), 3))
    print("GRAMMAR_DONE")


if __name__ == "__main__":
    main()
