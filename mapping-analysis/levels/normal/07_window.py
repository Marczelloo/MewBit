"""Podgląd fragmentu: nuty człowieka i algorytmu z pozycją na siatce ludzkiej (do opisu kandydatów).

Użycie: python -I 07_window.py <set_id> <od mm:ss> <do mm:ss>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from common import notes, slots

POS = {1: "1/1", 2: "1/2", 4: "1/4", 8: "1/8", 3: "1/3", 6: "1/6"}


def ms(x):
    m, s = x.split(":")
    return (int(m) * 60 + float(s)) * 1000


sid, a, b = int(sys.argv[1]), ms(sys.argv[2]), ms(sys.argv[3])
hs = slots("human", sid)
grid_t, grid_snap, grid_db, bib = hs["t"], hs["snap"], hs["downbeat"], hs["beat_in_bar"]
s2 = slots("algo", sid)
grid_t = np.concatenate([grid_t, s2["t"]]); grid_snap = np.concatenate([grid_snap, s2["snap"]]); bib = np.concatenate([bib, s2["beat_in_bar"]])
o = np.argsort(grid_t); grid_t, grid_snap, bib = grid_t[o], grid_snap[o], bib[o]
for who in ("human", "algo"):
    n = notes(who, sid)
    m = (n[:, 0] >= a) & (n[:, 0] < b)
    print(f"--- {who}: {m.sum()} nut")
    line = []
    for t in np.unique(n[m, 0]):
        i = np.argmin(np.abs(grid_t - t))
        here = n[n[:, 0] == t]
        lanes = "".join(str(int(x)) + ("H" if not np.isnan(e) else "") for x, e in zip(here[:, 1], here[:, 2]))
        tag = POS.get(int(grid_snap[i]), "?") if abs(grid_t[i] - t) <= 12 else f"off({t - grid_t[i]:+.0f}ms)"
        line.append(f"{t / 1000:7.3f}s b{bib[i]:.2f} {tag:<6} [{lanes}]" + "".join(f" H{int(x)}->{e / 1000:.3f}" for x, e in zip(here[:, 1], here[:, 2]) if not np.isnan(e)))
    print("\n".join(line))
