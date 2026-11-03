"""Where the generator's Easy chart departs most from the human Easy chart, per test song: the official note matching
(versus_human.precision / recall, metrics v2) and, within 4-bar windows, the same +-40 ms matching; 4-bar windows on the human grid scored by density ratio, missing half beats, notes inside holds, kiai and section
starts. Times are on the decoded audio's timeline (mm:ss); the bot may play another upload, so they are approximate."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import OUT, metrics, mmss, notes, slots, song

h = metrics("human")
a = metrics("algo")
te = h[h.split == "test"].set_index("set_id")
TOL = 40


def match(x, y):
    """share of x with a y within TOL"""
    if len(x) == 0 or len(y) == 0:
        return np.nan
    i = np.clip(np.searchsorted(y, x), 1, len(y) - 1)
    d = np.minimum(np.abs(y[i - 1] - x), np.abs(y[i] - x))
    return float(np.mean(d <= TOL))


rows, wins = [], []
for sid in a.set_id:
    hn, an = notes("human", sid), notes("algo", sid)
    ht = np.array(sorted({n[0] for n in hn}), float)
    at = np.array(sorted({n[0] for n in an}), float)
    so = song(sid)
    z = slots("human", sid)
    ar = a.set_index("set_id").loc[sid]
    rows.append({"set_id": sid, "artist": te.loc[sid, "artist"], "title": te.loc[sid, "title"], "genre": te.loc[sid, "genre"],
                 "precision": ar["versus_human.precision"], "recall": ar["versus_human.recall"],
                 "lane_overlap": ar["versus_human.lane_overlap_on_matched"], "grid_offset_p50_ms": ar["versus_human.grid_offset_ms.p50"]})
    # 4-bar windows on the human grid
    db_t = z["t"][z["downbeat"]]
    bars = db_t
    holds_a = [n for n in an if n[2] is not None]
    for k in range(0, len(bars) - 4, 2):
        t0, t1 = bars[k], bars[k + 4]
        hm = ht[(ht >= t0) & (ht < t1)]
        am = at[(at >= t0) & (at < t1)]
        hnn = sum(1 for n in hn if t0 <= n[0] < t1)
        ann = sum(1 for n in an if t0 <= n[0] < t1)
        m = (z["t"] >= t0) & (z["t"] < t1)
        half_h = int((z["mapped"][m] & (z["snap"][m] == 2)).sum())
        kiai = float(z["kiai"][m].mean())
        rms = float(z["rms"][m].mean())
        inside = 0
        for hh in holds_a:
            if t0 <= hh[0] < t1:
                inside += sum(1 for n in an if hh[0] < n[0] < hh[2])
        dbs = db_t[(db_t >= t0) & (db_t < t1)]
        db_h = sum(1 for d in dbs if np.any(np.abs(ht - d) <= 3))
        db_a = sum(1 for d in dbs if len(at) and np.min(np.abs(at - d)) <= 15)
        wins.append({"set_id": sid, "from_ms": t0, "to_ms": t1, "from": mmss(t0), "to": mmss(t1), "h_notes": hnn, "a_notes": ann,
                     "ratio": ann / max(1, hnn), "h_half": half_h, "a_inside_holds": inside, "kiai": kiai, "rms": rms,
                     "db_h": db_h, "db_a": db_a, "match_h": match(hm, am) if len(hm) else np.nan, "match_a": match(am, hm) if len(am) else np.nan})

R = pd.DataFrame(rows)
W = pd.DataFrame(wins)
W.to_csv(OUT / "fragment_windows.csv", index=False)
pd.set_option("display.width", 250)
pd.set_option("display.max_rows", 300)
print(R.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
print("\nprecision p10/p50/p90:", np.nanpercentile(R.precision, [10, 50, 90]).round(2), " recall:", np.nanpercentile(R.recall, [10, 50, 90]).round(2))
R.to_csv(OUT / "note_matching.csv", index=False)

print("\n== per song: the window with the lowest density ratio (loud windows only, rms >= song median) and the one with most notes inside holds")
for sid, g in W.groupby("set_id"):
    loud = g[g.rms >= g.rms.median()]
    lo = loud.sort_values(["ratio", "h_notes"], ascending=[True, False]).iloc[0]
    hi = g.sort_values("a_inside_holds", ascending=False).iloc[0]
    hh = g.sort_values("h_half", ascending=False).iloc[0]
    print(f"{sid}: low ratio {lo['from']}-{lo['to']} h={lo.h_notes} a={lo.a_notes} kiai={lo.kiai:.1f} db h/a {lo.db_h}/{lo.db_a}; "
          f"inside holds {hi['from']}-{hi['to']} n={hi.a_inside_holds}; most human 1/2 {hh['from']}-{hh['to']} half={hh.h_half} a={hh.a_notes}/h={hh.h_notes}")

print("\n== kiai starts and section boundaries per song: human vs generator at the boundary downbeat")
for sid in a.set_id:
    z = slots("human", sid)
    hn, an = notes("human", sid), notes("algo", sid)
    k = z["kiai"]
    starts = z["t"][np.where(k[1:] & ~k[:-1])[0] + 1]
    out = []
    for s in starts:
        hc = sum(1 for n in hn if abs(n[0] - s) <= 3)
        ac = sum(1 for n in an if abs(n[0] - s) <= 40)
        out.append(f"{mmss(s)} h{hc}/a{ac}")
    print(sid, "kiai:", ", ".join(out))
