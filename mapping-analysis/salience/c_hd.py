"""Apply the Normal-trained combination model to Hopes and Dreams, per phrase."""
import json, pickle, sys
import numpy as np
from common import *
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier

songs = load()
names = songs[0]["names"]
M = pickle.load(open("/scripts/models.pkl", "rb"))["R"]
kind = "hgb" if M["normal"]["hgb_all"]["auc"] > M["normal"]["lr_all"]["auc"] else "lr"
print("model used:", kind, "LR auc", M["normal"]["lr_all"]["auc"], "HGB auc", M["normal"]["hgb_all"]["auc"])
ss = songs_with(songs, "normal")
X = np.concatenate([s["Xr"] for s in ss]); y = np.concatenate([s["label"]["normal"] for s in ss])
if kind == "lr":
    model = LogisticRegression(C=1.0, max_iter=300).fit(X, y)
else:
    model = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=100, l2_regularization=1.0, random_state=0).fit(X, y)

# Normal density per beat on train
dens = [len(s["human"]["normal"]) / (s["dur"] * s["bpm"] / 60.0) for s in ss]
dpb = float(np.median(dens))
print("Normal moments per beat (train median): %.3f  -> per 16-beat phrase %.1f" % (dpb, dpb * 16))

hd = pickle.load(open("/scripts/feat/hd.pkl", "rb"))
Xh = rank_cols(hd["X"]); t = hd["t"]
score = model.predict_proba(Xh)[:, 1]
J = json.load(open("/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.json"))["features"]
col = lambda n: Xh[:, names.index(n)]
H = np.maximum(col("flux_H_lowmid"), col("flux_H_highmid"))
Pp = np.maximum.reduce([col("flux_P_lowmid"), col("flux_P_highmid"), col("flux_P_high")])
Lw = col("flux_full_low")
dom = np.argmax(np.stack([H, Pp, Lw], 1), 1)   # 0 harmonic mid, 1 percussive, 2 low
mbeat = col("m_beat") > 0; mhalf = col("m_half") > 0
os_b = col("os_broad")
drum_t = np.array([o["t"] for o in J["drums"]]); lead_t = np.array([o["t"] for o in J["lead"]])
k = int(round(dpb * 16))
print("phrase  start_s  end_s  ncand  k  | model top-k: H%% P%% L%% beat%% beat+half%% | os_broad top-k: H%% P%% L%% | drums lead")
rows = []
for i, (a, b, rep, lag) in enumerate(hd["phr"]):
    m = np.where((t >= a) & (t < b))[0]
    if len(m) == 0: continue
    kk = min(k, len(m))
    top = m[np.argsort(-score[m])[:kk]]
    topb = m[np.argsort(-os_b[m])[:kk]]
    sh = lambda idx, g: 100 * np.mean(dom[idx] == g)
    nd = int(((drum_t >= a) & (drum_t < b)).sum()); nl = int(((lead_t >= a) & (lead_t < b)).sum())
    r = (i, a / 1000, b / 1000, len(m), kk, sh(top, 0), sh(top, 1), sh(top, 2), 100 * mbeat[top].mean(), 100 * (mbeat[top] | mhalf[top]).mean(),
         sh(topb, 0), sh(topb, 1), sh(topb, 2), nd, nl)
    rows.append(r)
    print("%3d  %6.1f %6.1f  %4d %3d | %3.0f %3.0f %3.0f  %3.0f %3.0f | %3.0f %3.0f %3.0f | %4d %3d" % r)
R = np.array(rows)
def zone(lo, hi, label):
    sel = (R[:, 1] >= lo) & (R[:, 1] < hi)
    print("%-22s phrases %d | model H/P/L %.0f/%.0f/%.0f beat %.0f beat+half %.0f | os_broad H/P/L %.0f/%.0f/%.0f | drums %.0f lead %.0f per phrase" % (
        label, sel.sum(), *R[sel, 5:8].mean(0), R[sel, 8].mean(), R[sel, 9].mean(), *R[sel, 10:13].mean(0), R[sel, 13].mean(), R[sel, 14].mean()))
zone(0, 22, "solo melody 0-22 s")
zone(23, 135, "full band 23-135 s")
zone(135, 147, "quiet 135-146 s")
zone(147, 999, "after 147 s")
zone(0, 999, "all")
pickle.dump(dict(rows=rows, kind=kind, dpb=dpb), open("/scripts/hd_rows.pkl", "wb"))
