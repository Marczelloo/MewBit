"""Prints the human and generator notes of one window on the human grid: python 10_window.py <set_id> <from mm:ss> <to mm:ss>.
Each line: time, bar.beat (+fraction) on the human grid, the human moment, the generator moment (lane digits, h=hold)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from common import notes, slots

sid, f, t = int(sys.argv[1]), sys.argv[2], sys.argv[3]
ms = lambda s: (int(s.split(":")[0]) * 60 + float(s.split(":")[1])) * 1000
f, t = ms(f), ms(t)
z = slots("human", sid)
hn, an = notes("human", sid), notes("algo", sid)


def where(x):
    i = int(np.argmin(np.abs(z["t"] - x)))
    off = x - z["t"][i]
    frac = {1: "", 2: "+1/2", 4: "+1/4", 8: "+1/8", 3: "+1/3", 6: "+1/6"}[int(z["snap"][i])]
    pos = np.round(z["beat_in_bar"][i] * 12) / 12
    bar = int(z["bar_index"][i])
    if z["downbeat"][i] and pos > 0.5:  # x.99995 of the previous bar is beat 1 of this one
        pos, bar = 0.0, bar + 1
    beat = int(np.floor(pos)) + 1
    k = "K" if z["kiai"][i] else " "
    return f"{bar:3d}.{beat}{frac:5s} {off:+4.0f}ms {k}"


def moment(ns, x, tol):
    m = [n for n in ns if abs(n[0] - x) <= tol]
    return "".join(f"{n[1]}{'h' if n[2] is not None else ''}" for n in sorted(m, key=lambda n: n[1]))


times = sorted({n[0] for n in hn + an if f <= n[0] < t})
seen = []
for x in times:
    if seen and x - seen[-1] < 25:
        continue
    seen.append(x)
    print(f"{x / 1000:7.2f}s {where(x)}  H:{moment(hn, x, 20):6s} A:{moment(an, x, 20):6s}")
# holds of the generator running in the window
for n in an:
    if n[2] is not None and f <= n[0] < t:
        inside = [m for m in an if n[0] < m[0] < n[2]]
        print(f"  gen hold lane {n[1]} {n[0] / 1000:.2f}-{n[2] / 1000:.2f}s, ends at {where(n[2])}, notes inside: {len(inside)}")
for n in hn:
    if n[2] is not None and f <= n[0] < t:
        print(f"  human hold lane {n[1]} {n[0] / 1000:.2f}-{n[2] / 1000:.2f}s, ends at {where(n[2])}")
