"""Basic Pitch posteriors -> note list -> foreground line (the melody the chart generator reads).

A note is [t, len, midi, vel, conf, onset, layer, ghost, wob]: t, len in ms; vel = mean frame activation; conf = peak frame
activation near the start; onset = onset head at the start; layer: 0 bass (< C3), 1 mid (C3..B4), 2 high (>= C5); ghost = 1
when the note looks like an overtone of a lower note starting with it; wob = pitch instability of the note from the contour
head (voice, violin), in semitones. scripts/mewbeat-melody/line.js draws the same line again with other parameters.
"""
import numpy as np

FPS = 22050 / 256
MIDI0 = 21  # bin 0 of note/onset posteriors

P = dict(onset_thr=.5, frame_thr=.3, min_len_ms=58, gap_tol=11,
         retrig_gap_ms=25, retrig_onset=.62,
         # foreground line
         reg_mid=76., reg_width=16., bass_top=48, min_ioi_ms=85, jump=.05, base=.62, max_gap_ms=2500, rep_win_ms=2500, rep_weight=.75, rep_count=8., norm_win_ms=4000, norm_q=85, norm_floor=.12)

# The second run, at a lower onset threshold: a quiet line under a loud bed (REVOLVANIA's low synth) that the first run misses.
P_LOW = dict(P, onset_thr=.35, retrig_onset=.45)
SHORT_MS = 600


def peaks_time(o, thr):
    """local maxima in time per pitch, above thr"""
    up = np.zeros_like(o, dtype=bool)
    up[1:-1] = (o[1:-1] > o[:-2]) & (o[1:-1] >= o[2:]) & (o[1:-1] >= thr)
    return up


def walk(note, onset, a):
    """Notes from the onset peaks of the onset head only (the frame-diff onsets of Basic Pitch double a held note)."""
    n_fr, n_p = note.shape
    pk = peaks_time(onset, a["onset_thr"])
    tt, pp = np.where(pk)
    order = np.argsort(-tt)
    rem = note.copy()
    min_fr = int(round(a["min_len_ms"] / 1000 * FPS))
    out = []
    for i in order:
        t, p = int(tt[i]), int(pp[i])
        k, under = t + 1, 0
        while k < n_fr and under < a["gap_tol"]:
            under = under + 1 if rem[k, p] < a["frame_thr"] else 0
            k += 1
        k -= under
        if k - t < min_fr:
            continue
        rem[t:k, p] = 0
        if p > 0: rem[t:k, p - 1] = 0
        if p < n_p - 1: rem[t:k, p + 1] = 0
        out.append([t, k, p])
    out.sort()
    return out


def merge_retriggers(ev, onset, a):
    """A same-pitch note starting right where the last ended, on a weak onset, continues it."""
    byp = {}
    keep = []
    gap_fr = a["retrig_gap_ms"] / 1000 * FPS
    for e in ev:
        t, k, p = e
        last = byp.get(p)
        if last is not None and t - last[1] <= gap_fr and onset[t, p] < a["retrig_onset"]:
            last[1] = max(last[1], k)
            continue
        e = [t, k, p]
        byp[p] = e
        keep.append(e)
    return keep


def contour_wobble(contour, t, k, p):
    """Std of the contour's centroid (3 bins per semitone) around the note's pitch, in semitones."""
    c = 3 * p + 1
    lo, hi = max(c - 4, 0), min(c + 5, contour.shape[1])
    w = contour[t:k, lo:hi] + 1e-6
    x = (w * np.arange(lo, hi)).sum(1) / w.sum(1)
    return float(np.std(x) / 3) if len(x) >= 3 else 0.


def notes_of(note, onset, contour, a=P, lag_ms=0.):
    ev = merge_retriggers(walk(note, onset, a), onset, a)
    rows = []
    for t, k, p in ev:
        m = p + MIDI0
        vel = float(note[t:k, p].mean())
        conf = float(note[t:min(t + 8, k), p].max())
        on = float(onset[t, p])
        layer = 0 if m < 48 else (1 if m < 72 else 2)
        rows.append([t / FPS * 1000 + lag_ms, (k - t) / FPS * 1000, m, vel, conf, on, layer, 0, contour_wobble(contour, t, k, p)])
    rows = np.array(rows) if rows else np.zeros((0, 9))
    # overtones: starts within 35 ms of a lower note, sits on an octave or twelfth of it, and is not stronger
    for i in range(len(rows)):
        t, m, on, vel = rows[i, 0], rows[i, 2], rows[i, 5], rows[i, 3]
        j = i
        while j > 0 and t - rows[j - 1, 0] <= 35: j -= 1
        hi = i
        while hi + 1 < len(rows) and rows[hi + 1, 0] - t <= 35: hi += 1
        for q in range(j, hi + 1):
            if q != i and rows[q, 2] < m and int(m - rows[q, 2]) in (12, 19, 24, 28, 31) and rows[q, 3] >= vel * .8:
                rows[i, 7] = 1
                break
    return rows


def salience(rows, a=P):
    """How much a note stands out by itself: its onset and activation, the register, and how little its pitch repeats around it
    (an ostinato is the backing, whatever its loudness)."""
    if len(rows) == 0: return np.zeros(0)
    t, m, vel, on = rows[:, 0], rows[:, 2], rows[:, 3], rows[:, 5]
    reg = np.exp(-.5 * ((m - a["reg_mid"]) / a["reg_width"]) ** 2)
    rep = np.zeros(len(rows))
    w = a["rep_win_ms"]
    lo = np.searchsorted(t, t - w)
    hi = np.searchsorted(t, t + w)
    for i in range(len(rows)):
        s = np.arange(lo[i], hi[i])
        s = s[s != i]
        if len(s): rep[i] = min((rows[s, 2] == m[i]).sum() / a["rep_count"], 1.)
    sal = (on ** 1.5) * (vel ** .5) * reg * (1 - a["rep_weight"] * rep)
    sal[rows[:, 7] > 0] *= .4
    sal[m < a["bass_top"]] *= .5
    return sal


def local_salience(rows, a=P):
    """Salience against the notes around it: every section, loud and dense or quiet, then has its own line.
    A floor keeps a passage of nothing but faint notes from being raised to foreground."""
    sal = salience(rows, a)
    if len(rows) == 0: return sal
    t = rows[:, 0]
    lo = np.searchsorted(t, t - a["norm_win_ms"])
    hi = np.searchsorted(t, t + a["norm_win_ms"])
    out = np.zeros(len(sal))
    for i in range(len(sal)):
        out[i] = sal[i] / max(np.percentile(sal[lo[i]:hi[i]], a["norm_q"]), a["norm_floor"])
    return out


def foreground(rows, a=P):
    """One line through the notes: a chain maximising the salience above `base`, with a cost per semitone of jump."""
    n = len(rows)
    if n == 0: return []
    sal = local_salience(rows, a)
    t, m = rows[:, 0], rows[:, 2]
    gain = sal - a["base"]
    best = gain.copy()
    prev = -np.ones(n, dtype=int)
    for i in range(n):
        j = i - 1
        while j >= 0 and t[i] - t[j] <= a["max_gap_ms"]:
            if t[i] - t[j] >= a["min_ioi_ms"]:
                v = best[j] + gain[i] - a["jump"] * min(abs(m[i] - m[j]) / 12, 2.5)
                if v > best[i]:
                    best[i], prev[i] = v, j
            j -= 1
    # chains are cut at gaps: take the best chain ends greedily over time segments
    used = np.zeros(n, dtype=bool)
    out = []
    for e in np.argsort(-best):
        if best[e] <= 0 or used[e]: continue
        chain = []
        i = e
        while i >= 0 and not used[i]:
            chain.append(i)
            i = prev[i]
        if not chain: continue
        lo, hi = t[chain[-1]], t[chain[0]]
        # a chain overlapping a better one keeps only what lies outside it
        chain = [c for c in chain if not any(abs(t[c] - t[u]) < a["min_ioi_ms"] for u in out)]
        out.extend(chain)
        used[chain] = True
        used[(t >= lo) & (t <= hi)] = True
    return sorted(out)
