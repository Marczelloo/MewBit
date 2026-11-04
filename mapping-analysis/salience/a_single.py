"""Single-signal AUC / F1 per level, meter, repeat consensus, nesting, positive rates."""
import json, sys
import numpy as np
from common import *

songs = load()
names = songs[0]["names"]
print("songs", len(songs), "features", len(names))
out = {}

# basic stats
for lv in LV:
    ss = songs_with(songs, lv)
    pr = [s["label"][lv].mean() for s in ss]
    allpos = sum(s["label"][lv].sum() for s in ss); alln = sum(len(s["t"]) for s in ss)
    rec = [len(np.unique(s["hidx"][lv][s["hidx"][lv] >= 0])) / max(len(s["human"][lv]), 1) for s in ss]
    dens = [len(s["human"][lv]) / s["dur"] for s in ss]
    cd = [len(s["t"]) / s["dur"] for s in ss]
    out[f"stats_{lv}"] = dict(n=len(ss), pos_rate_pooled=allpos / alln, pos_rate_med=float(np.median(pr)),
                              cand_recall_med=float(np.median(rec)), human_per_s=float(np.median(dens)), cand_per_s=float(np.median(cd)))
    print(lv, out[f"stats_{lv}"])

# offsets
offs = np.concatenate([s["offset"][lv] for s in songs for lv in s["offset"]])
print("matched human-minus-candidate offset ms: mean %.1f median %.1f std %.1f" % (offs.mean(), np.median(offs), offs.std()))
out["offset"] = dict(mean=float(offs.mean()), median=float(np.median(offs)), std=float(offs.std()))

# single signals
res = {}
rng_rand = {}
for lv in LV:
    ss = songs_with(songs, lv)
    A = np.full((len(ss), len(names)), np.nan); F = np.full_like(A, np.nan)
    for i, s in enumerate(ss):
        y = s["label"][lv]
        for j in range(len(names)):
            col = s["Xr"][:, j]
            A[i, j] = auc_fast(col, y)
            F[i, j] = f1_topk(s["t"], col, s["hidx"][lv], s["human"][lv], seed=i)
    # random baseline
    Fr = []
    for i, s in enumerate(ss):
        r = np.random.default_rng(100 + i).random(len(s["t"]))
        Fr.append(f1_topk(s["t"], r, s["hidx"][lv], s["human"][lv], seed=i))
    res[lv] = dict(auc=np.nanmedian(A, 0), f1=np.nanmedian(F, 0), f1rand=float(np.nanmedian(Fr)), A=A, F=F, ids=[s["id"] for s in ss])
    print(lv, "random F1 median", res[lv]["f1rand"])

import pickle
pickle.dump(dict(names=names, res=res), open("/scripts/single.pkl", "wb"))
rows = []
for j, n in enumerate(names):
    rows.append((n, *[res[lv]["auc"][j] for lv in LV], *[res[lv]["f1"][j] for lv in LV]))
rows.sort(key=lambda r: -r[2])
print("%-22s %6s %6s %6s | %6s %6s %6s" % ("signal", "aucE", "aucN", "aucH", "f1E", "f1N", "f1H"))
for r in rows:
    print("%-22s %.3f %.3f %.3f | %.3f %.3f %.3f" % r)

# meter by class
print("\n--- positive rate by metrical class")
for good in (False, True):
    for lv in LV:
        ss = [s for s in songs_with(songs, lv) if (not good or s["conf"] >= 0.7)]
        X = np.concatenate([s["X"] for s in ss]); y = np.concatenate([s["label"][lv] for s in ss])
        line = []
        for c in ("m_beat", "m_half", "m_quarter", "m_other"):
            m = X[:, names.index(c)] > 0
            line.append("%s share %.2f pos %.3f" % (c, m.mean(), y[m].mean()))
        print("good" if good else "all ", lv, len(ss), " | ".join(line))
for good in (False, True):
    for lv in LV:
        ss = [s for s in songs_with(songs, lv) if (not good or s["conf"] >= 0.7)]
        a = {c: np.nanmedian([auc_fast(s["X"][:, names.index(c)], s["label"][lv]) for s in ss]) for c in ("m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid")}
        print("AUC", "good" if good else "all ", lv, len(ss), {k: round(float(v), 3) for k, v in a.items()})

# repeat consensus: AUC on has_repeat rows only, base vs rc
print("\n--- repeat consensus (rows in phrases with repeat links)")
hr = names.index("has_repeat")
print("songs with >=1 repeat link:", sum(1 for s in songs if s["X"][:, hr].sum() > 0), "share of candidates with link %.3f" % (np.concatenate([s["X"][:, hr] for s in songs]).mean()))
base = [n for n in names if not n.startswith("rc_") and not n.startswith("p_") and not n.startswith("m_") and n not in ("d_beat", "d_grid", "has_repeat")]
tab = []
for k in base:
    ja = names.index(k); jb = names.index("rc_" + k)
    line = [k]
    for lv in LV:
        da = []; db = []
        for s in songs_with(songs, lv):
            m = s["X"][:, hr] > 0
            if m.sum() < 200: continue
            y = s["label"][lv][m]
            a = auc_fast(s["Xr"][m, ja], y); b = auc_fast(s["Xr"][m, jb], y)
            if not np.isnan(a) and not np.isnan(b): da.append(a); db.append(b)
        line += [np.median(da), np.median(db), len(da)]
    tab.append(line)
tab.sort(key=lambda r: -r[4])
print("%-18s | easy base rc n | normal base rc n | hard base rc n" % "signal")
for r in tab:
    print("%-18s | %.3f %.3f %d | %.3f %.3f %d | %.3f %.3f %d" % tuple(r))

# nesting
print("\n--- nesting (share of lower-level moments with an upper-level moment within 35 ms)")
def share(a, b):
    if len(a) == 0 or len(b) == 0: return np.nan
    return float(np.mean(nearest_human(a, b) >= 0))
rngs = np.random.default_rng(5)
pairs = [("easy", "normal"), ("normal", "hard"), ("easy", "hard"), ("normal", "easy"), ("hard", "normal"), ("hard", "easy")]
for a, b in pairs:
    v = []; ch = []
    for s in songs:
        if a in s["human"] and b in s["human"]:
            v.append(share(s["human"][a], s["human"][b]))
            ch.append(np.mean([share(s["human"][a], np.sort(s["human"][b] + rngs.uniform(300, 1500))) for _ in range(10)]))
    print("%s in %s: median %.3f (chance-shifted %.3f) over %d songs" % (a, b, np.nanmedian(v), np.nanmedian(ch), len(v)))
