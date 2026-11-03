"""Wzorce na Hard (analiza pomocnicza na nutach): rodzaje akordów, długość tryli i jacków, balans rąk w oknach 4 taktów,
co jest w strumieniach 1/4.
Wynik: tables/patterns_per_chart.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, human, notes, slots

COMBOS = {(0, 1): "jedna ręka L", (2, 3): "jedna ręka P", (0, 3): "zewnętrzne", (1, 2): "wewnętrzne", (0, 2): "0+2", (1, 3): "1+3"}


def moments(nts):
    m = {}
    for n in nts:
        m.setdefault(n[0], set()).add(n[1])
    return [(t, tuple(sorted(l))) for t, l in sorted(m.items())]


def beat_of(z):
    beats = z["t"][z["snap"] == 1]
    return lambda t: np.interp(t, beats, np.arange(len(beats), dtype=float))


def analyse(who, sid, meta):
    z = slots("human", sid)
    f = beat_of(z)
    ms = moments(notes(who, sid))
    T = np.array([m[0] for m in ms], float)
    pos = f(T)
    out = dict(who=who, set_id=sid, **meta)
    chords = [m[1] for m in ms if len(m[1]) == 2]
    for k, name in COMBOS.items():
        out[f"chord2_{name}"] = np.mean([c == k for c in chords]) if chords else np.nan
    # trills: longest alternation x-y-x-y of single-lane moments (or equal chords)
    best, cur = 1, 1
    for i in range(2, len(ms)):
        if ms[i][1] == ms[i - 2][1] and ms[i][1] != ms[i - 1][1] and pos[i] - pos[i - 2] <= 1.01:
            cur = cur + 1 if cur > 1 else 3
            best = max(best, cur)
        else:
            cur = 1
    out["trill_max_notes"] = best
    # count of trills >= 10 notes per minute
    runs, cur = [], 1
    for i in range(2, len(ms)):
        if ms[i][1] == ms[i - 2][1] and ms[i][1] != ms[i - 1][1] and pos[i] - pos[i - 2] <= 1.01:
            cur = cur + 1 if cur > 1 else 3
        else:
            if cur >= 3:
                runs.append(cur)
            cur = 1
    minutes = (T[-1] - T[0]) / 60000 if len(T) > 1 else 1
    out["trills_ge10_per_min"] = sum(r >= 10 for r in runs) / minutes
    out["trills_per_min"] = len(runs) / minutes
    # hand balance in 4-bar windows (bars of the human grid)
    downs = z["t"][z["downbeat"]]
    nts = notes(who, sid)
    NT = np.array([n[0] for n in nts], float)
    NL = np.array([n[1] for n in nts])
    devs = []
    for k in range(0, len(downs) - 4, 4):
        sel = (NT >= downs[k] - 12) & (NT < downs[k + 4] - 12)
        if sel.sum() >= 8:
            devs.append(abs((NL[sel] < 2).mean() - 0.5))
    out["hand_dev4bar_p50"] = np.median(devs) if devs else np.nan
    out["hand_dev4bar_p90"] = np.quantile(devs, 0.9) if devs else np.nan
    out["hand_dev4bar_gt_0.2"] = np.mean(np.array(devs) > 0.2) if devs else np.nan
    # inside 1/4 streams (>=4 moments with 1/4 gaps): chords and lane pattern
    g = np.diff(pos)
    q = np.abs(g - 0.25) <= 0.03
    stream_idx = set()
    i = 0
    while i < len(q):
        j = i
        while j < len(q) and q[j]:
            j += 1
        if j - i >= 3:
            stream_idx.update(range(i, j + 1))
        i = j + 1
    st = sorted(stream_idx)
    out["moments_in_q_streams"] = len(st) / max(1, len(ms))
    out["chord_share_in_q_streams"] = np.mean([len(ms[k][1]) >= 2 for k in st]) if st else np.nan
    # one-lane consecutive (jack) at 1/2 beat or less among all moment pairs
    jack = [bool(set(ms[k][1]) & set(ms[k + 1][1])) and g[k] <= 0.51 for k in range(len(g))]
    out["jack_le_half_share"] = np.mean(jack) if jack else np.nan
    return out


h = human()
a = algo()
rows = [analyse("human", r.set_id, dict(split=r.split, genre=r.genre4, owner=r.owner, bpm=r.bpm)) for _, r in h.iterrows()]
rows += [analyse("algo", r.set_id, dict(split="test", genre=r.genre4, owner="algo", bpm=r.bpm)) for _, r in a.iterrows()]
P = pd.DataFrame(rows)
P["grp"] = np.where(P.who == "algo", "algo_test", "human_" + P.split)
P.to_csv(f"{TABLES}/patterns_per_chart.csv", index=False)
cols = [c for c in P.columns if c.startswith(("chord2_", "trill", "hand_dev", "moments_in", "chord_share_in", "jack_"))]
pd.set_option("display.width", 250)
print(P.groupby("grp")[cols].quantile([0.1, 0.5, 0.9]).round(3).T.to_string())
print("human charts with trill_max_notes > 9:", P[P.who == "human"].groupby("split").apply(lambda d: (d.trill_max_notes > 9).mean()))
