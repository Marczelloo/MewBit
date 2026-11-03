"""Kontrola: czy drgania czasu algorytmu (10–30 ms od siatki ludzkiej) zaniżają podobieństwo rytmu i serie 1/2.

Dla każdego utworu testowego: okna 4-taktowe (takty siatki ludzkiej), pozycje chwil w oknie (a) w binach 1/24 beatu z czasu surowego
(jak `repetition`), (b) po przyciągnięciu do najbliższego slotu siatki 1/8–1/6 (±40 ms). Średni Jaccard wszystkich par okien (linia bazowa).
Do tego najdłuższa seria odstępów ≈ 1/2 beatu przed i po przyciągnięciu. To nie są oficjalne metryki, tylko kontrola czułości.
Wynik: results/jitter_check.md
"""
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import RESULTS, algo, fmt_q, md_table, notes, slots


def grid_of(sid):
    t, bib, db = [], [], []
    for who in ("human", "algo"):
        s = slots(who, sid)
        t.append(s["t"]); bib.append(s["bpm"]); db.append(s["t"][s["downbeat"]])
    t = np.concatenate(t); bpm = np.concatenate(bib)
    o = np.argsort(t)
    return t[o], bpm[o], np.unique(np.round(np.concatenate(db), 1))


def analyse(who, sid, gt, gbpm, bars):
    n = notes(who, sid)
    mt = np.unique(n[:, 0])
    i = np.clip(np.searchsorted(gt, mt), 1, len(gt) - 1)
    j = np.where(np.abs(gt[i - 1] - mt) < np.abs(gt[i] - mt), i - 1, i)
    snapped = np.where(np.abs(gt[j] - mt) <= 40, gt[j], mt)
    res = {}
    for name, times in (("raw", mt), ("snap", snapped)):
        wins = []
        for k in range(0, len(bars) - 4, 4):
            a, b = bars[k], bars[k + 4]
            m = (times >= a) & (times < b)
            beat = 60000.0 / gbpm[np.clip(np.searchsorted(gt, a), 0, len(gt) - 1)]
            wins.append(set(np.round((times[m] - a) / beat * 24).astype(int)))
        js = [len(x & y) / len(x | y) for x, y in combinations(wins, 2) if x | y]
        res[f"jac_{name}"] = float(np.mean(js)) if js else np.nan
        beat_at = 60000.0 / gbpm[np.clip(np.searchsorted(gt, times[:-1]), 0, len(gt) - 1)]
        g = np.diff(np.unique(times)) / beat_at[: len(np.unique(times)) - 1]
        half = np.abs(g - 0.5) <= 0.03
        run = best = 0
        for x in half:
            run = run + 1 if x else 0
            best = max(best, run)
        res[f"run_{name}"] = best + 1 if best else 0
    return res


rows = []
for sid in algo().set_id:
    gt, gbpm, bars = grid_of(sid)
    for who in ("human", "algo"):
        r = analyse(who, sid, gt, gbpm, bars)
        r.update(set_id=sid, who=who)
        rows.append(r)
D = pd.DataFrame(rows)
out = []
for who in ("human", "algo"):
    d = D[D.who == who]
    out.append([who, fmt_q(d.jac_raw), fmt_q(d.jac_snap), fmt_q(d.run_raw), fmt_q(d.run_snap)])
txt = md_table(out, ["kto (test, 20 utworów)", "Jaccard rytmu okien, surowo (1/24)", "po przyciągnięciu do siatki", "maks. seria 1/2 surowo", "po przyciągnięciu"])
(RESULTS / "jitter_check.md").write_text(txt)
print(txt)
