"""Metrics of one 4-lane chart, measured on the human map's timing grid (definitions: shared/metrics.md).

The same function measures a human chart and an algorithm chart of the same song: both are read against the grid
of the human map (its red timing points), which is the reference for "where the beat is". Every metric here is
deterministic and needs no audio; music-aware metrics are in audio_metrics.py.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

import numpy as np

LANES = 4
SNAP_CLASSES = (1, 2, 3, 4, 6, 8, 12, 16)
# Gap fractions (in beats) a gap between moments is classified to; tolerance relative to the fraction.
GAP_CLASSES = (8.0, 6.0, 4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 1 / 16)
GAP_CLASS_TOLERANCE = 0.06
REST_BEATS = (2.0, 4.0, 8.0)
WINDOW_S = 2.0
WINDOW_HOP_S = 0.5
PEAK_WINDOW_S = 8.0


@dataclass(frozen=True)
class N:
    t: int
    lane: int
    end: int | None = None

    @property
    def hold(self) -> bool:
        return self.end is not None and self.end > self.t


def from_osu(notes) -> list[N]:
    return sorted((N(int(n.t), int(n.lane), int(n.end) if n.is_hold else None) for n in notes), key=lambda n: (n.t, n.lane))


def from_mewbeat(chart: dict) -> list[N]:
    out = []
    for n in chart.get("notes", []):
        ln = n.get("len")
        out.append(N(int(n["t"]), int(n["lane"]), int(n["t"] + ln) if ln and ln > 0 else None))
    return sorted(out, key=lambda n: (n.t, n.lane))


def moments_of(notes: list[N]) -> list[list[N]]:
    out: list[list[N]] = []
    for n in notes:
        if out and out[-1][0].t == n.t:
            out[-1].append(n)
        else:
            out.append([n])
    return out


def gap_class(beats: float) -> float | None:
    for g in GAP_CLASSES:
        if abs(beats - g) <= GAP_CLASS_TOLERANCE * g:
            return g
    return None


def _label(g: float | None) -> str:
    if g is None:
        return "other"
    names = {2 / 3: "2/3", 1 / 3: "1/3", 1 / 6: "1/6", 1 / 12: "1/12", 1 / 16: "1/16", 0.125: "1/8", 0.25: "1/4", 0.5: "1/2", 0.75: "3/4", 1.5: "3/2"}
    return names.get(g, f"{g:g}")


GAP_LABELS = tuple(sorted({_label(g) for g in GAP_CLASSES} | {"other"}))


def _quantiles(values, qs=(0.1, 0.5, 0.9)) -> dict:
    if len(values) == 0:
        return {f"p{int(q * 100)}": None for q in qs}
    arr = np.asarray(values, dtype=float)
    return {f"p{int(q * 100)}": float(np.quantile(arr, q)) for q in qs}


def _runs(flags: list[bool]) -> list[int]:
    runs, cur = [], 0
    for f in flags:
        if f:
            cur += 1
        elif cur:
            runs.append(cur)
            cur = 0
    if cur:
        runs.append(cur)
    return runs


HUMAN_TOL_MS = 2.5  # editor-placed notes: integer ms on the map's own grid
ALGO_TOL_MS = 10.0  # generator notes: its beat tracker works in 10.7 ms hops (see shared/metrics.md, "Tolerancja siatki")
ALGO_TOL_BEATS = 0.03  # ...and never more than this share of a beat, so 1/6 and 1/8 stay apart up to ~240 BPM


def tolerance_of(grid, kind: str):
    if kind == "human":
        return lambda t: HUMAN_TOL_MS
    return lambda t: min(ALGO_TOL_MS, ALGO_TOL_BEATS * grid.beat_ms(t))


def grid_error_ms(grid, t: float, d: int | None) -> float | None:
    if d is None:
        return None
    pos, i = grid.local_pos(t)
    L = grid.reds[i].beat_length
    return abs(pos * d - round(pos * d)) * L / d


def quantized(grid, t: float, d: int | None) -> float:
    """t moved onto the exact grid point of the divisor it was classified to (unchanged when off-grid). Human notes are
    on it already; for generator notes this removes the 4-8 ms beat-tracker jitter before rhythm is compared."""
    if d is None:
        return float(t)
    pos, i = grid.local_pos(t)
    p = grid.reds[i]
    return p.t + round(pos * d) / d * p.beat_length


HOLD_LEN_TOL_BEATS = 0.05  # hold-length classes allow this much: a 1/2-beat hold rounded to ms reads 0.4998


def chart_metrics(notes: list[N], grid, breaks: list[tuple[int, int]] | None = None, span: tuple[float, float] | None = None,
                  kind: str = "human") -> dict:
    """All grid-relative metrics of one chart. `span` (ms) limits the chart to a time range (default: its own).
    `kind` ("human" or "algo") sets the grid tolerance (tolerance_of)."""
    tol = tolerance_of(grid, kind)
    if span is not None:
        notes = [n for n in notes if span[0] <= n.t < span[1]]
    if len(notes) < 2:
        return {"n_notes": len(notes), "valid": False}
    moments = moments_of(notes)
    times = np.array([m[0].t for m in moments], dtype=float)
    first = float(notes[0].t)
    last = float(max(n.end if n.hold else n.t for n in notes))
    break_ms = sum(max(0, min(b, last) - max(a, first)) for a, b in (breaks or []))
    drain_s = max(1e-3, (last - first - break_ms) / 1000.0)
    drain_beats = grid.beat_pos(last) - grid.beat_pos(first)
    out: dict = {"valid": True, "first_ms": first, "last_ms": last, "drain_s": drain_s, "drain_beats": drain_beats}

    # --- density -----------------------------------------------------------------------------------------------
    n_notes, n_moments = len(notes), len(moments)
    holds = [n for n in notes if n.hold]
    out.update(n_notes=n_notes, n_moments=n_moments, n_holds=len(holds),
               nps=n_notes / drain_s, mps=n_moments / drain_s,
               notes_per_beat=n_notes / max(1e-9, drain_beats), moments_per_beat=n_moments / max(1e-9, drain_beats))
    note_t = np.array([n.t for n in notes], dtype=float)
    starts = np.arange(first, max(first + 1, last - WINDOW_S * 1000 + 1), WINDOW_HOP_S * 1000)
    counts = np.searchsorted(note_t, starts + WINDOW_S * 1000) - np.searchsorted(note_t, starts)
    win_nps = counts / WINDOW_S
    out["nps_window"] = {**_quantiles(win_nps), "max": float(win_nps.max()) if len(win_nps) else 0.0}
    peak = 0
    j = 0
    for i in range(len(note_t)):
        while note_t[i] - note_t[j] >= PEAK_WINDOW_S * 1000:
            j += 1
        peak = max(peak, i - j + 1)
    out["nps_peak8s"] = peak / PEAK_WINDOW_S

    # --- rhythm ------------------------------------------------------------------------------------------------
    snaps = [grid.snap(t, tol(t)) for t in times]
    sc = Counter(snaps)
    qtimes = np.array([quantized(grid, t, d) for t, d in zip(times, snaps)])
    errs = [e for e in (grid_error_ms(grid, t, d) for t, d in zip(times, snaps)) if e is not None]
    out["grid_error_ms"] = _quantiles(errs, (0.5, 0.9))
    out["snap_share"] = {str(d): sc.get(d, 0) / n_moments for d in SNAP_CLASSES} | {"off": sc.get(None, 0) / n_moments}
    out["triplet_share"] = sum(sc.get(d, 0) for d in (3, 6, 12)) / n_moments
    out["on_beat_share"] = sc.get(1, 0) / n_moments
    downbeat_flags = [grid.is_downbeat(t, tol(t)) for t in times]
    out["on_downbeat_share"] = float(np.mean(downbeat_flags))
    bars = grid.beats(first, last + 1, 1)
    bar_starts = [b for b in bars if grid.is_downbeat(b)]  # grid points: exact
    if bar_starts:
        # a moment within the grid tolerance of the downbeat carries it
        hit = [bool(np.any(np.abs(times - b) <= tol(b))) for b in bar_starts]
        out["downbeats_carried"] = float(np.mean(hit))
    gaps_ms = np.diff(times)
    # On quantized positions (v2): the gap class is the rhythm the chart means, not the tracker's jitter.
    gaps_beats = np.array([(grid.beat_pos(b) - grid.beat_pos(a)) for a, b in zip(qtimes[:-1], qtimes[1:])])
    gc = Counter(_label(gap_class(g)) for g in gaps_beats)
    # Every class is reported, absent ones as 0 (v2.1): a missing key became an empty table cell that medians skipped.
    out["gap_share"] = {k: gc.get(k, 0) / len(gaps_beats) for k in GAP_LABELS}
    out["gap_ms"] = {"min": float(gaps_ms.min()), **_quantiles(gaps_ms, (0.05, 0.5))}
    out["gap_beats"] = _quantiles(gaps_beats, (0.05, 0.25, 0.5, 0.75))
    # Runs of consecutive gaps of one length (RC: "consecutive 1/2", "consecutive 1/4"): notes in the run = gaps + 1.
    for name, g in (("1/1", 1.0), ("1/2", 0.5), ("1/4", 0.25), ("1/3", 1 / 3), ("1/6", 1 / 6), ("1/8", 0.125)):
        runs = _runs([gap_class(x) == g for x in gaps_beats])
        notes_in = [r + 1 for r in runs]
        out[f"run_{name}"] = {"count_per_min": len(runs) / (drain_s / 60), "max_notes": max(notes_in, default=0),
                              "p90_notes": _quantiles(notes_in, (0.9,))["p90"]}
    fast = _runs([x <= 0.25 + 1e-6 for x in gaps_beats])
    out["fast_runs_1_4_or_finer"] = {"count_per_min": len(fast) / (drain_s / 60), "max_notes": max((r + 1 for r in fast), default=0)}

    # --- chords ------------------------------------------------------------------------------------------------
    sizes = Counter(len(m) for m in moments)
    out["chord_size_share"] = {str(k): sizes.get(k, 0) / n_moments for k in range(1, LANES + 1)}
    chord_idx = [i for i, m in enumerate(moments) if len(m) >= 2]
    out["chord_share"] = len(chord_idx) / n_moments
    if chord_idx:
        pos = Counter("downbeat" if downbeat_flags[i] else "beat" if snaps[i] == 1 else "offbeat" for i in chord_idx)
        out["chord_position_share"] = {k: pos.get(k, 0) / len(chord_idx) for k in ("downbeat", "beat", "offbeat")}
        split = [i for i in chord_idx if len(moments[i]) == 2 and len({n.lane >> 1 for n in moments[i]}) == 2]
        two = [i for i in chord_idx if len(moments[i]) == 2]
        out["chord2_split_hands_share"] = len(split) / len(two) if two else None
        # chords inside a 1/4-or-finer stream (both neighbouring gaps <= 1/4 beat)
        inside = [i for i in chord_idx if 0 < i < n_moments - 1 and gaps_beats[i - 1] <= 0.26 and gaps_beats[i] <= 0.26]
        out["chords_in_fast_stream_per_min"] = len(inside) / (drain_s / 60)
    else:
        out["chord_position_share"] = {"downbeat": None, "beat": None, "offbeat": None}
        out["chord2_split_hands_share"] = None
        out["chords_in_fast_stream_per_min"] = 0.0

    # --- jacks and anchors ---------------------------------------------------------------------------------------
    lane_sets = [{n.lane for n in m} for m in moments]
    minijack = [i for i in range(1, n_moments) if lane_sets[i] & lane_sets[i - 1]]
    out["minijack_share"] = len(minijack) / max(1, n_moments - 1)
    jack_gaps = [gaps_beats[i - 1] for i in minijack]
    out["minijack_gap_beats"] = _quantiles(jack_gaps, (0.1, 0.5))
    out["minijack_fast_share"] = (sum(1 for g in jack_gaps if g <= 0.26) / max(1, n_moments - 1))
    longest_jack = 0
    for lane in range(LANES):
        run = 0
        for s in lane_sets:
            run = run + 1 if lane in s else 0
            longest_jack = max(longest_jack, run)
    out["jack_max_notes"] = longest_jack
    longest_anchor = 0
    for lane in range(LANES):
        idx = [i for i, s in enumerate(lane_sets) if lane in s]
        run = 1
        for a, b in zip(idx, idx[1:]):
            run = run + 1 if b - a == 2 else 1
            longest_anchor = max(longest_anchor, run)
    out["anchor_max_notes"] = longest_anchor

    # --- holds -------------------------------------------------------------------------------------------------
    out["hold_share"] = len(holds) / n_notes
    if holds:
        qs = {h: quantized(grid, h.t, grid.snap(h.t, tol(h.t))) for h in holds}
        qe = {h: quantized(grid, h.end, grid.snap(h.end, tol(h.end))) for h in holds}
        lens = [grid.beat_pos(qe[h]) - grid.beat_pos(qs[h]) for h in holds]
        out["hold_len_beats"] = _quantiles(lens)
        out["hold_short_share"] = {"lt_1_2": float(np.mean([x < 0.5 - HOLD_LEN_TOL_BEATS for x in lens])),
                                   "lt_1": float(np.mean([x < 1 - HOLD_LEN_TOL_BEATS for x in lens]))}
        inside = [any(h.t < n.t < h.end for n in notes if n is not h) for h in holds]
        out["holds_with_notes_inside_share"] = float(np.mean(inside))
        other_hand = [sum(1 for n in notes if h.t < n.t < h.end and (n.lane >> 1) != (h.lane >> 1)) / max(1e-9, (grid.beat_pos(h.end) - grid.beat_pos(h.t))) for h in holds]
        out["other_hand_notes_per_beat_in_hold"] = _quantiles(other_hand, (0.5, 0.9))
        rel = sorted(h.end for h in holds)
        rel_gaps = [grid.beat_pos(b) - grid.beat_pos(a) for a, b in zip(rel, rel[1:]) if b > a]
        out["release_gap_beats"] = _quantiles(rel_gaps, (0.05, 0.5))
        rs = Counter(grid.snap(h.end, tol(h.end)) for h in holds)
        out["release_snap_share"] = {str(d): rs.get(d, 0) / len(holds) for d in SNAP_CLASSES} | {"off": rs.get(None, 0) / len(holds)}
        out["max_simultaneous_holds"] = max(sum(1 for o in holds if o.t <= h.t < o.end) for h in holds)
    else:
        out["hold_len_beats"] = _quantiles([])
        out["hold_short_share"] = {"lt_1_2": None, "lt_1": None}
        out["holds_with_notes_inside_share"] = None
        out["other_hand_notes_per_beat_in_hold"] = _quantiles([], (0.5, 0.9))
        out["release_gap_beats"] = _quantiles([], (0.05, 0.5))
        out["release_snap_share"] = {}
        out["max_simultaneous_holds"] = 0

    # --- lanes and patterns --------------------------------------------------------------------------------------
    lc = Counter(n.lane for n in notes)
    out["lane_share"] = [lc.get(l, 0) / n_notes for l in range(LANES)]
    out["left_hand_share"] = (lc.get(0, 0) + lc.get(1, 0)) / n_notes
    singles = [(i, next(iter(s))) for i, s in enumerate(lane_sets) if len(s) == 1]
    steps = [(b[1] - a[1]) for a, b in zip(singles, singles[1:]) if b[0] == a[0] + 1]
    if steps:
        sc2 = Counter(abs(s) for s in steps)
        out["single_step_share"] = {str(k): sc2.get(k, 0) / len(steps) for k in range(LANES)}
        out["hand_switch_share"] = float(np.mean([((a[1] >> 1) != (b[1] >> 1)) for a, b in zip(singles, singles[1:]) if b[0] == a[0] + 1]))
    else:
        out["single_step_share"] = {str(k): None for k in range(LANES)}
        out["hand_switch_share"] = None
    seq = [tuple(sorted(s)) for s in lane_sets]
    trill = stair = 0
    for i in range(2, len(seq)):
        a, b, c = seq[i - 2], seq[i - 1], seq[i]
        if len(a) == len(b) == len(c) == 1:
            x, y, z = a[0], b[0], c[0]
            if x == z and x != y:
                trill += 1
            elif (y - x) == (z - y) and abs(y - x) == 1:
                stair += 1
        elif len(a) == len(b) == len(c) == 2 and a == c and not set(a) & set(b):
            trill += 1  # jumptrill step
    out["trill_share"] = trill / max(1, len(seq) - 2)
    out["stair_share"] = stair / max(1, len(seq) - 2)
    # Pattern variety: entropy of 4-moment lane-shape n-grams (shapes are relative: mirrored/shifted shapes differ).
    grams = Counter(tuple(seq[i:i + 4]) for i in range(len(seq) - 3))
    total = sum(grams.values())
    if total:
        p = np.array(list(grams.values()), dtype=float) / total
        out["pattern4_entropy_bits"] = float(-(p * np.log2(p)).sum())
        out["pattern4_distinct_per_100"] = 100 * len(grams) / total
    else:
        out["pattern4_entropy_bits"] = None
        out["pattern4_distinct_per_100"] = None

    # --- rests and contrast --------------------------------------------------------------------------------------
    ends = []
    running_end = -math.inf
    for m in moments:
        running_end = max(running_end, max(n.end if n.hold else n.t for n in m))
        ends.append(running_end)
    rest_beats = np.array([grid.beat_pos(times[i + 1]) - grid.beat_pos(ends[i]) for i in range(n_moments - 1)])
    rest_ms = np.array([times[i + 1] - ends[i] for i in range(n_moments - 1)])
    for rb in REST_BEATS:
        mask = rest_beats >= rb - 1e-6
        out[f"rests_ge_{int(rb)}b"] = {"per_min": float(mask.sum()) / (drain_s / 60), "time_share": float(rest_ms[mask].sum()) / 1000 / drain_s}
    out["longest_rest_beats"] = float(rest_beats.max()) if len(rest_beats) else 0.0
    # Density per bar (downbeat to downbeat) and per 4 bars.
    if len(bar_starts) >= 3:
        edges = np.array(bar_starts + [grid.time_at(grid.beat_pos(bar_starts[-1]) + grid.meter(bar_starts[-1]))])
        per_bar = np.histogram(note_t, bins=edges)[0].astype(float)
        out["bar_notes"] = _quantiles(per_bar)
        out["bar_notes_cv"] = float(per_bar.std() / per_bar.mean()) if per_bar.mean() > 0 else None
        per4 = np.add.reduceat(per_bar, np.arange(0, len(per_bar), 4))
        out["phrase4_notes_p90_over_p10"] = float(np.quantile(per4, 0.9) / max(1.0, np.quantile(per4, 0.1)))
        out["empty_bar_share"] = float(np.mean(per_bar == 0))
    # Kiai (the mapper's own "this is the highlight" mark) vs the rest.
    kiai_flags = np.array([grid.in_kiai(t) for t in note_t])
    kiai_ms = sum(max(0.0, min(b, last) - max(a, first)) for a, b in grid.kiai_spans)
    if kiai_ms > 4000 and (last - first - kiai_ms) > 4000:
        out["kiai_density_ratio"] = (kiai_flags.sum() / kiai_ms) / max(1e-9, (~kiai_flags).sum() / (last - first - kiai_ms))
    else:
        out["kiai_density_ratio"] = None
    out.update(extra_metrics(notes, moments, times, qtimes, snaps, gaps_beats, grid, tol, first, last, drain_s))
    return out


def extra_metrics(notes, moments, times, qtimes, snaps, gaps_beats, grid, tol, first, last, drain_s) -> dict:
    """Metrics added after stage 2 asked for them (shared/metrics.md, "Dodane po etapie 2"), for every level."""
    out: dict = {}
    n_moments = len(moments)
    per_min = lambda k: k / max(1e-9, drain_s / 60)
    sizes = np.array([len(m) for m in moments])

    def has_moment(t):
        i = np.searchsorted(times, t)
        return any(0 <= j < len(times) and abs(times[j] - t) <= tol(t) for j in (i - 1, i))

    def moment_at(t):
        i = np.searchsorted(times, t)
        best = [j for j in (i - 1, i) if 0 <= j < len(times) and abs(times[j] - t) <= tol(t)]
        return min(best, key=lambda j: abs(times[j] - t)) if best else None

    # Grid coverage: share of beat / half-beat / quarter points of the active span that carry a moment.
    beats = grid.beats(first, last + 1, 1)
    halves = [t for t in grid.beats(first, last + 1, 2) if grid.snap(t) == 2]
    quarters = [t for t in grid.beats(first, last + 1, 4) if grid.snap(t) == 4]
    cov = lambda pts: float(np.mean([has_moment(t) for t in pts])) if pts else None
    out["coverage"] = {"beat": cov(beats), "half": cov(halves), "quarter": cov(quarters),
                       "beat_kiai": cov([t for t in beats if grid.in_kiai(t)]), "beat_no_kiai": cov([t for t in beats if not grid.in_kiai(t)])}
    on_beats = [moment_at(t) for t in beats]
    on_beats = [j for j in on_beats if j is not None]
    out["chord_rate_on_mapped_beats"] = float(np.mean(sizes[on_beats] >= 2)) if on_beats else None

    # Chords inside 1/2 runs (RC Easy) and close chord pairs inside 1/4 streams (RC Hard).
    is_half = [gap_class(g) == 0.5 for g in gaps_beats]
    inside_half = [i for i in range(1, n_moments - 1) if sizes[i] >= 2 and is_half[i - 1] and is_half[i]]
    out["chords_in_half_runs_per_min"] = per_min(len(inside_half))
    fast = [g <= 0.26 for g in gaps_beats]
    pairs = close = 0
    i = 0
    while i < len(fast):
        if not fast[i]:
            i += 1
            continue
        j = i
        while j < len(fast) and fast[j]:
            j += 1
        idx = list(range(i, j + 1))  # moments of the stream
        if len(idx) >= 5:
            chords = [k for k in idx[1:-1] if sizes[k] >= 2]
            for a, b in zip(chords, chords[1:]):
                pairs += 1
                close += (grid.beat_pos(qtimes[b]) - grid.beat_pos(qtimes[a])) < 1 - 1e-6
        i = j
    out["chord_pairs_in_quarter_streams"] = {"pairs": pairs, "closer_than_1_beat_share": close / pairs if pairs else None}

    # Hand balance in 4-bar windows with at least 8 notes.
    devs = []
    for a, b in bar_windows(grid, first, last, 4):
        win = [n for n in notes if a <= n.t < b]
        if len(win) >= 8:
            devs.append(abs(sum(n.lane < 2 for n in win) / len(win) - 0.5))
    out["hand_balance_4bar"] = {"p50": float(np.median(devs)) if devs else None, "p90": float(np.quantile(devs, 0.9)) if devs else None,
                                "over_0_2_share": float(np.mean([d > 0.2 for d in devs])) if devs else None, "windows": len(devs)}

    # Trills: runs of single-note moments alternating between two lanes, at most 1 beat apart.
    lanes = [next(iter({n.lane for n in m})) if len({n.lane for n in m}) == 1 else None for m in moments]
    runs = []
    k = 0
    while k < n_moments - 1:
        if lanes[k] is None or lanes[k + 1] is None or lanes[k] == lanes[k + 1] or gaps_beats[k] > 1 + 1e-6:
            k += 1
            continue
        x, y = lanes[k], lanes[k + 1]
        e = k + 1
        while e + 1 < n_moments and lanes[e + 1] == (x if (e + 1 - k) % 2 == 0 else y) and gaps_beats[e] <= 1 + 1e-6:
            e += 1
        if e - k + 1 >= 3:
            runs.append((e - k + 1, (x >> 1) == (y >> 1)))
        k = e
    out["trills"] = {"max_notes": max((r[0] for r in runs), default=0), "ge10_per_min": per_min(sum(r[0] >= 10 for r in runs)),
                     "one_hand_share": float(np.mean([r[1] for r in runs])) if runs else None, "runs_per_min": per_min(len(runs))}

    # Anchors in the RC sense: inside a stream (gaps <= 1/4 beat, >= 5 moments) one column hit every 2nd or 3rd moment,
    # with at least two other columns in between (a two-column trill is not an anchor).
    best = 0
    i = 0
    while i < len(fast):
        if not fast[i]:
            i += 1
            continue
        j = i
        while j < len(fast) and fast[j]:
            j += 1
        idx = list(range(i, j + 1))
        if len(idx) >= 5:
            for col in range(LANES):
                hits = [q for q in idx if any(n.lane == col for n in moments[q])]
                chain, others = 1, set()
                for a, b in zip(hits, hits[1:]):
                    between = {n.lane for q in range(a + 1, b) for n in moments[q]} - {col}
                    if b - a in (2, 3):
                        chain += 1
                        others |= between
                    else:
                        chain, others = 1, set()
                    if len(others) >= 2:
                        best = max(best, chain)
        i = j
    out["anchor_rc_max_notes"] = best

    # Hold context.
    holds = [n for n in notes if n.hold]
    if holds:
        beat = lambda t: grid.beat_ms(t)
        rel_next, start_beat, in_chord = [], [], []
        by_len = {"1/2": [], "1": [], "2+": []}
        shields = 0
        moment_of = {m[0].t: m for m in moments}
        for h in holds:
            later = times[times > h.t]
            cand = later[later >= h.end - beat(h.end) / 16]
            if len(cand):
                rel_next.append(abs(cand[0] - h.end) <= beat(h.end) / 16)
            start_beat.append(grid.snap(h.t, tol(h.t)) == 1)
            in_chord.append(len(moment_of[h.t]) >= 2)
            length = (grid.beat_pos(h.end) - grid.beat_pos(h.t))
            cls = "1/2" if length < 0.75 else "1" if length < 1.5 else "2+"
            by_len[cls].append(any(h.t < n.t < h.end for n in notes))
            prev = [n for n in notes if n.lane == h.lane and n.t < h.t]
            if prev and h.t - max(p.t for p in prev) <= 0.25 * beat(h.t) + tol(h.t):
                shields += 1
        out["holds_context"] = {
            "release_at_next_moment_share": float(np.mean(rel_next)) if rel_next else None,
            "start_on_beat_share": float(np.mean(start_beat)), "head_in_chord_share": float(np.mean(in_chord)),
            "notes_inside_share_by_length": {k: (float(np.mean(v)) if v else None) for k, v in by_len.items()},
            "holds_by_length": {k: len(v) for k, v in by_len.items()},
            "shield_1_4_per_min": per_min(shields),
        }
    else:
        out["holds_context"] = {"release_at_next_moment_share": None, "start_on_beat_share": None, "head_in_chord_share": None,
                                "notes_inside_share_by_length": {"1/2": None, "1": None, "2+": None},
                                "holds_by_length": {"1/2": 0, "1": 0, "2+": 0}, "shield_1_4_per_min": 0.0}

    # Kiai starts: the grid point nearest each kiai start inside the chart's span.
    starts = [a for a, _ in grid.kiai_spans if first <= a <= last]
    hits = []
    for a in starts:
        j = moment_at(a)
        hits.append((j is not None, j is not None and sizes[j] >= 2))
    out["kiai_start"] = {"n": len(starts), "note_share": float(np.mean([h[0] for h in hits])) if hits else None,
                         "chord_share": float(np.mean([h[1] for h in hits])) if hits else None}
    return out


def bar_windows(grid, first: float, last: float, bars: int = 4) -> list[tuple[float, float]]:
    """Consecutive windows of `bars` bars from the first downbeat at or after `first`."""
    downs = [b for b in grid.beats(first, last + 1, 1) if grid.is_downbeat(b)]
    return [(downs[i], downs[i + bars]) for i in range(0, len(downs) - bars, bars)]


def pattern_identity(notes: list[N], grid, a: tuple[float, float], b: tuple[float, float], slots_per_beat: int = 24,
                     kind: str = "human") -> dict:
    """How alike the chart plays two windows: rhythm Jaccard on 1/24-beat slots and lane identity of shared moments.
    Positions are quantized to the classified grid point first (v2), so generator jitter is not read as another rhythm."""
    tol = tolerance_of(grid, kind)

    def slots(w):
        pa = grid.beat_pos(w[0])
        out = {}
        for m in moments_of([n for n in notes if w[0] <= n.t < w[1]]):
            t = m[0].t
            k = int(round((grid.beat_pos(quantized(grid, t, grid.snap(t, tol(t)))) - pa) * slots_per_beat))
            out[k] = tuple(sorted(n.lane for n in m))
        return out
    sa, sb = slots(a), slots(b)
    if not sa and not sb:
        return {"rhythm": None, "lanes": None, "lanes_or_mirror": None}
    shared = set(sa) & set(sb)
    rhythm = len(shared) / len(set(sa) | set(sb))
    if not shared:
        return {"rhythm": rhythm, "lanes": 0.0, "lanes_or_mirror": 0.0}
    same = sum(1 for k in shared if sa[k] == sb[k]) / len(shared)
    mirror = sum(1 for k in shared if sa[k] == tuple(sorted(LANES - 1 - l for l in sb[k]))) / len(shared)
    return {"rhythm": rhythm, "lanes": same, "lanes_or_mirror": max(same, mirror)}
