"""Music-aware metrics: how a chart's notes relate to the audio (definitions: shared/metrics.md).

Inputs per song: the human map's TimingGrid, the librosa features (.npz from librosa_features.py), the plugin
features (features JSON v2) and, for algorithm charts, the generator's own analysis (dump_analysis.js).
"""

from __future__ import annotations

import math

import numpy as np

from chart_metrics import N, bar_windows, moments_of, pattern_identity, tolerance_of

TOL_MS = 25.0  # a note "sits on" an event this close (inside GREAT, 75 ms; wider than the onset detectors' spread)
NOTHING_MS = 40.0  # a note farther than this from every onset of every detector has no sound under it
PLUGIN_CLASSES = ("kick", "snare", "hat", "perc", "bass", "lead", "low", "lowmid", "highmid", "high")
LIBROSA_CLASSES = ("full", "perc", "harm", "low", "lowmid", "highmid", "high")
STEM_CLASSES = ("stem_drums", "stem_bass", "stem_vocals", "stem_other")


def detector_classes(npz) -> tuple[str, ...]:
    """librosa detectors, plus the stem detectors when stems were merged in (pipeline --stems)."""
    keys = set(npz.keys()) if hasattr(npz, "keys") else set(npz.files)
    return LIBROSA_CLASSES + tuple(c for c in STEM_CLASSES if f"onsets_{c}" in keys)
SLOT_DIVS = (1, 2, 3, 4, 6, 8)  # slots of the slot table: every 1/8 and every 1/6 beat
STRUCT_KERNEL_BARS = 8
REPEAT_SIM = 0.75  # 4-bar windows at least this alike in the audio are a musical repeat (calibrated: shared/metrics.md)
NONREPEAT_SIM = 0.6  # ...and at most this alike, a non-repeat (the baseline)


# --- helpers ---------------------------------------------------------------------------------------------------


def nearest_dist(sorted_times: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Signed distance from each t to the nearest value of sorted_times (value - t); inf when empty."""
    if len(sorted_times) == 0:
        return np.full(len(t), np.inf)
    i = np.clip(np.searchsorted(sorted_times, t), 1, len(sorted_times) - 1) if len(sorted_times) > 1 else np.zeros(len(t), int)
    if len(sorted_times) == 1:
        return sorted_times[0] - t
    left, right = sorted_times[i - 1] - t, sorted_times[i] - t
    return np.where(np.abs(left) <= np.abs(right), left, right)


def plugin_events(features: dict) -> dict[str, np.ndarray]:
    """Event times (ms) and strengths per class from the plugin features: {cls: array[[t, s], ...]}."""
    out: dict[str, list] = {c: [] for c in PLUGIN_CLASSES}
    for d in features.get("drums") or []:
        if d.get("kind") in out:
            out[d["kind"]].append((d["t"], d.get("s", 0)))
    for layer in ("bass", "lead"):
        for n in features.get(layer) or []:
            if n.get("conf", 0) >= 0.45:  # TONAL_MIN_CONF: what the generator trusts
                out[layer].append((n["t"], n.get("s", 0)))
    for b in features.get("bands") or []:
        if b.get("name") in out:
            out[b["name"]] = [(o["t"], o.get("s", 0)) for o in b.get("onsets", [])]
    return {k: np.array(sorted(v), dtype=float).reshape(-1, 2) for k, v in out.items()}


def corrected_onsets(npz, cls: str, bias_ms: dict[str, float]) -> np.ndarray:
    return np.sort(npz[f"onsets_{cls}"].astype(float) - bias_ms.get(cls, 0.0))


def frame_value(env: np.ndarray, t_ms: np.ndarray, hop_ms: float, reach_frames: int = 1) -> np.ndarray:
    """Max of an envelope within +-reach frames of each time."""
    idx = np.round(t_ms / hop_ms).astype(int)
    vals = np.zeros(len(t_ms))
    for k in range(-reach_frames, reach_frames + 1):
        j = np.clip(idx + k, 0, len(env) - 1)
        vals = np.maximum(vals, env[j])
    return vals


# --- the osu! timeline against the decoded audio ------------------------------------------------------------------

OFFSET_SEARCH_MS = 100  # lags searched: -100..+100 ms
OFFSET_TOL_MS = 15


def _share_at(on: np.ndarray, times: np.ndarray, lag: float, tol: float) -> float:
    if len(on) < 2 or len(times) == 0:
        return 0.0
    t = times + lag
    i = np.clip(np.searchsorted(on, t), 1, len(on) - 1)
    return float(np.mean(np.minimum(np.abs(on[i] - t), np.abs(on[i - 1] - t)) <= tol))


def _fit_lag(on: np.ndarray, times: np.ndarray) -> tuple[float, float, float]:
    """(lag, share at lag, share at 0): the centre of the plateau of best shares (a +-15 ms tolerance makes the best
    share flat over a range of lags), refined by the median signed distance of the notes that sit on an onset."""
    lags = np.arange(-OFFSET_SEARCH_MS, OFFSET_SEARCH_MS + 1)
    shares = np.array([_share_at(on, times, l, OFFSET_TOL_MS) for l in lags])
    k = int(np.argmax(shares))
    lo = hi = k
    while lo > 0 and shares[lo - 1] >= shares[k] - 0.005:
        lo -= 1
    while hi < len(lags) - 1 and shares[hi + 1] >= shares[k] - 0.005:
        hi += 1
    coarse = float(lags[(lo + hi) // 2])
    if len(on) < 2 or len(times) == 0:
        return coarse, float(shares[k]), float(shares[OFFSET_SEARCH_MS])
    t = times + coarse
    i = np.clip(np.searchsorted(on, t), 1, len(on) - 1)
    d = np.where(np.abs(on[i] - t) <= np.abs(on[i - 1] - t), on[i] - t, on[i - 1] - t)
    near = np.abs(d) <= OFFSET_TOL_MS
    lag = coarse + (float(np.median(d[near])) if near.any() else 0.0)
    return lag, _share_at(on, times, lag, OFFSET_TOL_MS), float(shares[OFFSET_SEARCH_MS])


def estimate_offset(times_ms, npz, events: dict[str, np.ndarray], bias_ms: dict[str, float]) -> dict:
    """The shift (ms) that moves human note times onto the decoded audio, fitted against percussive onsets (librosa,
    bias-corrected); the plugin's lowmid onsets give an independent check. One parameter per song: it absorbs the MP3
    decoder delay ffmpeg trims and the mapper's own offset."""
    times = np.asarray(sorted(set(times_ms)), dtype=float)
    lag, share, zero = _fit_lag(corrected_onsets(npz, "perc", bias_ms), times)
    lowmid = np.sort(events["lowmid"][:, 0]) if len(events.get("lowmid", [])) else np.array([])
    lm_lag, lm_share, _ = _fit_lag(lowmid, times)
    return {"offset_ms": int(round(lag)), "share_at_offset": share, "share_at_zero": zero,
            "plugin_lowmid_offset_ms": int(round(lm_lag)), "plugin_lowmid_share": lm_share,
            "agreement_ms": int(round(abs(lag - lm_lag))), "notes": int(len(times))}


# --- alignment and which sounds are mapped -----------------------------------------------------------------------


def onset_alignment(notes: list[N], npz, bias_ms: dict[str, float]) -> dict:
    times = np.array([m[0].t for m in moments_of(notes)], dtype=float)
    out = {}
    all_onsets = []
    for cls in detector_classes(npz):
        on = corrected_onsets(npz, cls, bias_ms)
        all_onsets.append(on)
        d = nearest_dist(on, times)
        near = np.abs(d) <= TOL_MS
        out[cls] = {"share": float(near.mean()), "median_signed_ms": float(np.median(d[near])) if near.any() else None}
    every = np.sort(np.concatenate(all_onsets))
    out["no_sound_share"] = float((np.abs(nearest_dist(every, times)) > NOTHING_MS).mean())
    return out


def plugin_coincidence(notes: list[N], events: dict[str, np.ndarray], span: tuple[float, float]) -> dict:
    """Per plugin class: share of the chart's moments on such an event, and share of such events (in the chart's span)
    that carry a moment ("recall"), for all events and for strong ones (s >= 0.5)."""
    times = np.array([m[0].t for m in moments_of(notes)], dtype=float)
    out = {}
    for cls, ev in events.items():
        inside = ev[(ev[:, 0] >= span[0]) & (ev[:, 0] < span[1])] if len(ev) else ev
        if len(inside) == 0:
            out[cls] = {"moment_share": 0.0, "recall": None, "recall_strong": None, "events": 0}
            continue
        et = np.sort(inside[:, 0])
        moment_share = float((np.abs(nearest_dist(et, times)) <= TOL_MS).mean()) if len(times) else 0.0
        mapped = np.abs(nearest_dist(times, inside[:, 0])) <= TOL_MS
        strong = inside[:, 1] >= 0.5
        out[cls] = {"moment_share": moment_share, "recall": float(mapped.mean()),
                    "recall_strong": float(mapped[strong].mean()) if strong.any() else None, "events": int(len(inside))}
    return out


def slot_table(notes: list[N], grid, npz, events: dict[str, np.ndarray], span: tuple[float, float], bias_ms: dict[str, float],
               kind: str = "human") -> dict[str, np.ndarray]:
    """One row per grid slot (every 1/8 and every 1/6 beat) of the span: where it sits, what the audio has there and
    whether the chart maps it. Columns are arrays of equal length (see shared/metrics.md, "Tabela slotów")."""
    pts = sorted(set(round(t, 1) for d in (8, 6) for t in grid.beats(span[0], span[1], d)))
    t = np.array(pts, dtype=float)
    hop_ms = float(npz["hop"]) * 1000.0 / float(npz["sr"])
    cols: dict[str, np.ndarray] = {"t": t}
    cols["snap"] = np.array([grid.snap(x) or 0 for x in t])
    cols["beat_in_bar"] = np.array([grid.beat_in_bar(x) for x in t])
    cols["downbeat"] = np.array([grid.is_downbeat(x) for x in t])
    cols["kiai"] = np.array([grid.in_kiai(x) for x in t])
    cols["bpm"] = np.array([grid.bpm(x) for x in t])
    # Phrase position: beat index inside its 4-bar window from the first downbeat (16 beats in 4/4).
    downs = np.array([b for b in grid.beats(span[0], span[1] + 1, 1) if grid.is_downbeat(b)])
    if len(downs):
        k = np.clip(np.searchsorted(downs, t + 1e-6) - 1, 0, None)
        cols["bar_index"] = k
        cols["phrase4_bar"] = k % 4
    rms = npz["rms"].astype(float)
    ref = np.quantile(rms[rms > 0], 0.95) if (rms > 0).any() else 1.0
    cols["rms"] = frame_value(rms, t, hop_ms, 2) / ref
    for cls in detector_classes(npz):
        env = npz[f"env_{cls}"].astype(float)
        e_ref = np.quantile(env, 0.99) or 1.0
        shifted = t + bias_ms.get(cls, 0.0)  # envelope frames carry the detector's bias too
        cols[f"env_{cls}"] = frame_value(env, shifted, hop_ms, 1) / e_ref
        cols[f"onset_{cls}"] = np.abs(nearest_dist(corrected_onsets(npz, cls, bias_ms), t)) <= TOL_MS
    for cls, ev in events.items():
        if len(ev) == 0:
            cols[f"ev_{cls}"] = np.zeros(len(t))
            continue
        order = np.argsort(ev[:, 0])
        et, es = ev[order, 0], ev[order, 1]
        d = nearest_dist(et, t)
        idx = np.clip(np.searchsorted(et, t + d - 1e-6), 0, len(et) - 1)
        cols[f"ev_{cls}"] = np.where(np.abs(d) <= TOL_MS, es[idx], 0.0)
    moments = moments_of(notes)
    mt = np.array([m[0].t for m in moments], dtype=float)
    d = nearest_dist(mt, t)
    near = np.abs(d) <= TOL_MS
    idx = np.clip(np.searchsorted(mt, t + d - 1e-6), 0, max(0, len(mt) - 1))
    cols["mapped"] = near
    cols["n_notes"] = np.where(near, [len(moments[i]) if len(moments) else 0 for i in idx], 0)
    cols["hold_start"] = np.where(near, [any(n.hold for n in moments[i]) if len(moments) else False for i in idx], False)
    # `chosen` (v2): every moment owns exactly one slot. `mapped` lights every slot within 25 ms, so at >= 180 BPM one
    # moment lights a 1/8 slot and the 1/6 slot beside it. A moment takes the coarsest-divisor slot within its source's
    # grid tolerance (the same rule as its snap class), else the nearest slot within 25 ms.
    tol = tolerance_of(grid, kind)
    chosen = np.zeros(len(t), dtype=bool)
    chosen_n = np.zeros(len(t), dtype=int)
    chosen_hold = np.zeros(len(t), dtype=bool)
    order = {d: k for k, d in enumerate((1, 2, 4, 3, 8, 6, 12, 16))}
    for m in moments:
        mt0 = float(m[0].t)
        lo, hi = np.searchsorted(t, mt0 - TOL_MS), np.searchsorted(t, mt0 + TOL_MS, side="right")
        cand = [k for k in range(lo, hi) if not chosen[k]]
        if not cand:
            continue
        within = [k for k in cand if abs(t[k] - mt0) <= tol(mt0)]
        k = min(within, key=lambda k: (order.get(int(cols["snap"][k]), 99), abs(t[k] - mt0))) if within else min(cand, key=lambda k: abs(t[k] - mt0))
        chosen[k], chosen_n[k], chosen_hold[k] = True, len(m), any(n.hold for n in m)
    cols["chosen"], cols["chosen_n_notes"], cols["chosen_hold_start"] = chosen, chosen_n, chosen_hold
    return cols


# --- structure, sections, contrast ---------------------------------------------------------------------------


def bar_features(grid, npz, span: tuple[float, float]) -> dict:
    """Per bar (human downbeats): mean chroma, MFCC, RMS and onset rate; the bar edges."""
    downs = [b for b in grid.beats(span[0], span[1] + 1, 1) if grid.is_downbeat(b)]
    if len(downs) < 2:
        return {"edges": np.array(downs)}
    hop_ms = float(npz["hop"]) * 1000.0 / float(npz["sr"])
    edges = np.array(downs)
    fi = np.clip((edges / hop_ms).astype(int), 0, npz["rms"].shape[0] - 1)
    chroma, mfcc, rms = npz["chroma"], npz["mfcc"], npz["rms"]
    on = npz["onsets_full"].astype(float)
    feats = {"edges": edges, "chroma": [], "mfcc": [], "rms": [], "onset_rate": []}
    for a, b, ta, tb in zip(fi[:-1], fi[1:], edges[:-1], edges[1:]):
        b = max(b, a + 1)
        feats["chroma"].append(chroma[:, a:b].mean(axis=1))
        feats["mfcc"].append(mfcc[:, a:b].mean(axis=1))
        feats["rms"].append(float(rms[a:b].mean()))
        feats["onset_rate"].append(float(((on >= ta) & (on < tb)).sum() / max(1e-3, (tb - ta) / 1000)))
    for k in ("chroma", "mfcc"):
        feats[k] = np.array(feats[k])
    feats["rms"] = np.array(feats["rms"])
    feats["onset_rate"] = np.array(feats["onset_rate"])
    return feats


def _z(x: np.ndarray) -> np.ndarray:
    s = x.std(axis=0)
    return (x - x.mean(axis=0)) / np.where(s > 0, s, 1)


def section_boundaries(bars: dict, kernel: int = STRUCT_KERNEL_BARS) -> list[int]:
    """Bar indices where the music changes: peaks of a checkerboard novelty on the bar self-similarity (Foote 2000)."""
    if "chroma" not in bars or len(bars["rms"]) < 2 * kernel + 2:
        return []
    X = np.hstack([_z(bars["chroma"]), _z(bars["mfcc"]), _z(np.log1p(bars["rms"])[:, None]) * 2])
    X = X / np.maximum(1e-9, np.linalg.norm(X, axis=1, keepdims=True))
    Ssm = X @ X.T
    h = kernel // 2
    sign = np.ones((kernel, kernel))
    sign[:h, h:] = sign[h:, :h] = -1
    nov = np.zeros(len(X))
    for i in range(h, len(X) - h):
        nov[i] = (Ssm[i - h:i + h, i - h:i + h] * sign).sum()
    thr = nov.mean() + 0.5 * nov.std()
    peaks = [i for i in range(1, len(nov) - 1) if nov[i] >= thr and nov[i] >= nov[i - 1] and nov[i] >= nov[i + 1]]
    out: list[int] = []
    for p in sorted(peaks, key=lambda i: -nov[i]):
        if all(abs(p - q) >= 4 for q in out):
            out.append(p)
    return sorted(out)


def section_metrics(notes: list[N], grid, bars: dict, boundaries: list[int]) -> dict:
    """Density around section changes and how density follows the audio, per bar. A note "on" a boundary is within
    25 ms of its downbeat (v2; it was 3 ms, which read the generator's 4-8 ms jitter as a missing note)."""
    edges = bars.get("edges", np.array([]))
    if len(edges) < 3:
        return {}
    note_t = np.array([n.t for n in notes], dtype=float)
    per_bar = np.histogram(note_t, bins=edges)[0].astype(float)
    out: dict = {}
    from scipy.stats import spearmanr
    if per_bar.std() > 0 and bars["rms"].std() > 0:
        out["bar_density_vs_rms_spearman"] = float(spearmanr(per_bar, bars["rms"]).statistic)
    if per_bar.std() > 0 and bars["onset_rate"].std() > 0:
        out["bar_density_vs_onset_rate_spearman"] = float(spearmanr(per_bar, bars["onset_rate"]).statistic)
    moment_list = moments_of(notes)
    chord_t = np.array([m[0].t for m in moment_list if len(m) >= 2], dtype=float)
    per_bar_chords = np.histogram(chord_t, bins=edges)[0].astype(float)
    if per_bar_chords.std() > 0 and bars["rms"].std() > 0:
        out["bar_chords_vs_rms_spearman"] = float(spearmanr(per_bar_chords, bars["rms"]).statistic)
    norm = max(1.0, float(np.median(per_bar)))
    rows = []
    moments = {m[0].t: len(m) for m in moment_list}
    for b in boundaries:
        if b < 4 or b + 4 > len(per_bar):
            continue
        before, after = per_bar[b - 4:b].mean(), per_bar[b:b + 4].mean()
        last_before, prev3 = per_bar[b - 1], per_bar[b - 4:b - 1].mean()
        t0 = edges[b]
        near = sorted((k for k in moments if abs(k - t0) <= TOL_MS), key=lambda k: abs(k - t0))
        beat = grid.beat_ms(t0)
        rows.append({
            "profile": [float(per_bar[b + k] / norm) if 0 <= b + k < len(per_bar) else None for k in range(-4, 4)],
            "empty_last_beat": not any(t0 - beat - TOL_MS <= k < t0 - TOL_MS for k in moments),
            "after_over_before": after / max(0.25, before),
            "last_bar_over_prev3": last_before / max(0.25, prev3),
            "note_on_boundary": bool(near),
            "chord_on_boundary": bool(near and moments[near[0]] >= 2),
            "rms_after_over_before": float(bars["rms"][b:b + 4].mean() / max(1e-9, bars["rms"][b - 4:b].mean())),
        })
    out["n_boundaries"] = len(rows)
    if rows:
        for k in ("after_over_before", "last_bar_over_prev3", "rms_after_over_before"):
            out[f"boundary_{k}_median"] = float(np.median([r[k] for r in rows]))
        out["boundary_note_share"] = float(np.mean([r["note_on_boundary"] for r in rows]))
        out["boundary_chord_share"] = float(np.mean([r["chord_on_boundary"] for r in rows]))
        rising = [r for r in rows if r["rms_after_over_before"] >= 1.25]
        falling = [r for r in rows if r["rms_after_over_before"] <= 0.8]
        out["boundary_rising_density_ratio_median"] = float(np.median([r["after_over_before"] for r in rising])) if rising else None
        out["boundary_falling_density_ratio_median"] = float(np.median([r["after_over_before"] for r in falling])) if falling else None
        out["boundary_empty_last_beat_share"] = float(np.mean([r["empty_last_beat"] for r in rows]))
        for name, group in (("all", rows), ("rising", rising), ("falling", falling)):
            prof = [[r["profile"][k] for r in group if r["profile"][k] is not None] for k in range(8)]
            out[f"boundary_profile_{name}"] = [float(np.median(v)) if v else None for v in prof]  # bars -4..+3, / the median bar
        out["boundary_rows"] = rows
    return out


# --- repetition ----------------------------------------------------------------------------------------------------


def window_features(grid, npz, windows: list[tuple[float, float]]) -> np.ndarray:
    """Per 4-bar window: per-beat harmonic chroma and per-1/4-beat onset envelope, concatenated and unit-normed."""
    hop_ms = float(npz["hop"]) * 1000.0 / float(npz["sr"])
    chroma, env = npz["chroma"], npz["env_full"].astype(float)
    rows = []
    for a, b in windows:
        beats = grid.beats(a, b, 1)
        quarter = grid.beats(a, b, 4)
        c = []
        for x, y in zip(beats, beats[1:] + [b]):
            i, j = int(x / hop_ms), max(int(x / hop_ms) + 1, int(y / hop_ms))
            v = chroma[:, i:j].mean(axis=1)
            c.append(v - v.mean())
        e = frame_value(env, np.array(quarter), hop_ms, 1)
        e = (e - e.mean()) / (e.std() or 1)
        v = np.concatenate([np.concatenate(c) * 0.6 / max(1e-9, np.linalg.norm(np.concatenate(c))), e * 0.4 / max(1e-9, np.linalg.norm(e))])
        rows.append(v)
    n = max(len(r) for r in rows) if rows else 0
    X = np.array([np.pad(r, (0, n - len(r))) for r in rows]) if rows else np.zeros((0, 0))
    return X / np.maximum(1e-9, np.linalg.norm(X, axis=1, keepdims=True)) if len(X) else X


def repetition_metrics(notes: list[N], grid, npz, span: tuple[float, float], kind: str = "human") -> dict:
    windows = bar_windows(grid, span[0], span[1], 4)
    if len(windows) < 4:
        return {}
    X = window_features(grid, npz, windows)
    S = X @ X.T
    rep, base = [], []
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            if S[i, j] >= REPEAT_SIM:
                rep.append((i, j))
            elif S[i, j] <= NONREPEAT_SIM:
                base.append((i, j))
    def mean_identity(pairs):
        vals = [pattern_identity(notes, grid, windows[i], windows[j], kind=kind) for i, j in pairs]
        vals = [v for v in vals if v["rhythm"] is not None]
        if not vals:
            return None
        return {k: float(np.mean([v[k] for v in vals])) for k in ("rhythm", "lanes", "lanes_or_mirror")} | {"pairs": len(vals)}
    # Threshold sweep, for the calibration in shared/metrics.md (which threshold still separates repeats from the baseline).
    sweep = {}
    for thr in (0.70, 0.75, 0.80, 0.85, 0.90):
        pairs = [(i, j) for i in range(len(windows)) for j in range(i + 1, len(windows)) if S[i, j] >= thr]
        sweep[f"{thr:.2f}"] = {"pairs": len(pairs), "identity": mean_identity(pairs[:400])}
    return {"repeat_pairs": len(rep), "repeat": mean_identity(rep), "baseline": mean_identity(base[:400]), "sweep": sweep}


# --- added after stage 2 (shared/metrics.md, "Dodane po etapie 2") -----------------------------------------------------


def rest_context(notes: list[N], grid, npz, boundaries_ms: list[float]) -> dict:
    """Rests of >= 4 beats: how loud the music is under them, and how many sit at a section boundary (within a bar)."""
    moments = moments_of(notes)
    hop_ms = float(npz["hop"]) * 1000.0 / float(npz["sr"])
    rms = npz["rms"].astype(float)
    ref = np.quantile(rms[rms > 0], 0.95) if (rms > 0).any() else 1.0
    end = -np.inf
    rows = []
    for a, b in zip(moments, moments[1:]):
        end = max(end, max(n.end if n.hold else n.t for n in a))
        t0, t1 = end, float(b[0].t)
        if t1 <= t0 or grid.beat_pos(t1) - grid.beat_pos(t0) < 4 - 1e-6:
            continue
        i, j = int(t0 / hop_ms), max(int(t0 / hop_ms) + 1, int(t1 / hop_ms))
        loud = float(rms[i:j].mean() / ref) if j <= len(rms) else None
        bar = 4 * grid.beat_ms(t0)
        at_boundary = any(t0 - bar <= x <= t1 + bar for x in boundaries_ms)
        rows.append((loud, at_boundary))
    louds = [r[0] for r in rows if r[0] is not None]
    return {"rests_ge_4b": len(rows), "loud_share": float(np.mean([x >= 0.5 for x in louds])) if louds else None,
            "rms_p50": float(np.median(louds)) if louds else None,
            "at_boundary_share": float(np.mean([r[1] for r in rows])) if rows else None}


def hand_by_class(notes: list[N], events: dict[str, np.ndarray]) -> dict:
    """For moments on a plugin event of a class (within 25 ms): the share of their notes on the left hand."""
    moments = moments_of(notes)
    times = np.array([m[0].t for m in moments], dtype=float)
    out = {}
    for cls in ("kick", "snare", "hat", "bass", "lead"):
        ev = events.get(cls)
        if ev is None or len(ev) == 0 or len(times) == 0:
            out[cls] = {"left_share": None, "notes": 0}
            continue
        on = np.abs(nearest_dist(np.sort(ev[:, 0]), times)) <= TOL_MS
        lanes = [n.lane for m, flag in zip(moments, on) if flag for n in m]
        out[cls] = {"left_share": float(np.mean([l < 2 for l in lanes])) if lanes else None, "notes": len(lanes)}
    return out


def versus_human(algo: list[N], human: list[N], grid, tol_ms: float = 40.0) -> dict:
    """Generator chart against the human chart of the same song and level: precision and recall of moments within
    40 ms, lane agreement on matched moments, and the signed offset of generator moments from the nearest 1/8 or 1/6
    point of the human grid (grid_error_ms only measures it against the divisor a moment was classified to)."""
    am_ = moments_of(algo)
    hm = moments_of(human)
    at = np.array([m[0].t for m in am_], dtype=float)
    ht = np.array([m[0].t for m in hm], dtype=float)
    if len(at) == 0 or len(ht) == 0:
        return {}
    da = nearest_dist(ht, at)
    dh = nearest_dist(at, ht)
    matched = np.abs(da) <= tol_ms
    same_lanes = []
    for k in np.where(matched)[0]:
        j = int(np.argmin(np.abs(ht - at[k])))
        same_lanes.append(len({n.lane for n in am_[k]} & {n.lane for n in hm[j]}) > 0)
    pts = np.array(sorted(set(round(x, 1) for d in (8, 6) for x in grid.beats(at[0] - 1000, at[-1] + 1000, d))))
    off = nearest_dist(pts, at) * -1  # algo - grid point
    return {"precision": float(matched.mean()), "recall": float((np.abs(dh) <= tol_ms).mean()),
            "lane_overlap_on_matched": float(np.mean(same_lanes)) if same_lanes else None,
            "grid_offset_ms": {"p10": float(np.quantile(off, 0.1)), "p50": float(np.median(off)), "p90": float(np.quantile(off, 0.9)),
                               "abs_over_10ms_share": float((np.abs(off) > 10).mean())}}


# --- the algorithm's beat grid against the human one --------------------------------------------------------------


def beat_tracking(analysis: dict, grid, span: tuple[float, float], tol_ms: float = 20.0) -> dict:
    """Where the generator's beats (after folding) land on the human grid."""
    tm = analysis.get("timing", {})
    if not tm.get("snapped"):
        return {"snapped": False}
    beats = np.array([b for b in tm.get("beats", []) if span[0] <= b < span[1]], dtype=float)
    if len(beats) < 4:
        return {"snapped": True, "beats": int(len(beats))}
    human1 = np.array(grid.beats(span[0] - 2000, span[1] + 2000, 1))
    human2 = np.array(grid.beats(span[0] - 2000, span[1] + 2000, 2))
    human4 = np.array(grid.beats(span[0] - 2000, span[1] + 2000, 4))
    d1 = np.abs(nearest_dist(human1, beats))
    d2 = np.abs(nearest_dist(human2, beats))
    d4 = np.abs(nearest_dist(human4, beats))
    on_beat = d1 <= tol_ms
    ratio = np.median([grid.beat_ms(b) for b in beats]) / float(tm["medianMs"])
    downs = np.array([d for d in tm.get("downbeats", []) if span[0] <= d < span[1]], dtype=float)
    human_down = np.array([b for b in human1 if grid.is_downbeat(b)])
    return {
        "snapped": True,
        "beats": int(len(beats)),
        "human_beat_over_algo_beat": float(ratio),  # 1 = same tempo, 2 = algorithm at double time, 0.5 = half time
        "on_human_beat_share": float(on_beat.mean()),
        "on_human_half_not_beat_share": float(((d2 <= tol_ms) & ~on_beat).mean()),
        "on_human_quarter_only_share": float(((d4 <= tol_ms) & (d2 > tol_ms)).mean()),
        "off_grid_share": float((d4 > tol_ms).mean()),
        "median_abs_error_ms_on_beat": float(np.median(d1[on_beat])) if on_beat.any() else None,
        "downbeat_on_human_downbeat_share": float((np.abs(nearest_dist(human_down, downs)) <= tol_ms).mean()) if len(downs) and len(human_down) else None,
        "fold_factor": tm.get("foldFactor"),
    }
