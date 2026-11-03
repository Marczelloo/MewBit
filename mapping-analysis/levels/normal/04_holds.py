"""Holdy na Normal: długość (z tolerancją), co dzieje się w trakcie, gdzie zaczynają się i kończą.

Pomocnicze pomiary z nut (nie są oficjalnymi metrykami; zob. „Prośby o nowe metryki” w REPORT.md):
- długość holda w beatach z tolerancją ±5% (beat z kolumny `bpm` tabeli slotów w chwili startu),
- nuty startujące w trakcie holda: ta sama ręka / druga ręka, akord na starcie holda,
- odstęp od puszczenia do następnej chwili (w beatach),
- gdzie startuje hold (pozycja w takcie, w bloku 4 taktów) i czy po nim jest przerwa.
Do tego regresja logistyczna `hold_start` wśród zmapowanych slotów.

Wynik: results/holds.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from common import RESULTS, algo, fmt, fmt_q, human, md_table, notes, slots

H = human()
A = algo()


def beat_ms_at(s, t):
    i = np.clip(np.searchsorted(s["t"], t), 0, len(s["t"]) - 1)
    return 60000.0 / s["bpm"][i]


def per_chart(who, set_id):
    n = notes(who, set_id)
    s = slots(who, set_id)
    t, lane, end = n[:, 0], n[:, 1].astype(int), n[:, 2]
    hold = ~np.isnan(end)
    res = dict(set_id=set_id, who=who, n_holds=int(hold.sum()), n_notes=len(n))
    if hold.sum() == 0:
        return res, []
    rows = []
    mom_t = np.unique(t)
    for i in np.where(hold)[0]:
        b = beat_ms_at(s, t[i])
        L = (end[i] - t[i]) / b
        inside = (t > t[i]) & (t < end[i])
        same = inside & ((lane >> 1) == (lane[i] >> 1))
        other = inside & ((lane >> 1) != (lane[i] >> 1))
        chord_start = ((t == t[i]) & (np.arange(len(t)) != i)).any()
        nxt = mom_t[mom_t >= end[i] - 1]
        after = (nxt[0] - end[i]) / b if len(nxt) else np.nan
        prev = mom_t[mom_t < t[i]]
        before = (t[i] - prev[-1]) / b if len(prev) else np.nan
        # pozycja startu i końca na siatce slotów
        j = np.argmin(np.abs(s["t"] - t[i]))
        k = np.argmin(np.abs(s["t"] - end[i]))
        rows.append(dict(len_beats=L, inside_same=int(same.sum()), inside_other=int(other.sum()), other_per_beat=other.sum() / max(L, 1e-9),
                         chord_start=chord_start, gap_after_release=after, gap_before=before,
                         start_snap=int(s["snap"][j]) if abs(s["t"][j] - t[i]) < 15 else 0,
                         end_snap=int(s["snap"][k]) if abs(s["t"][k] - end[i]) < 15 else 0,
                         start_downbeat=bool(s["downbeat"][j]) and abs(s["t"][j] - t[i]) < 15,
                         start_bar4=int(s["phrase4_bar"][j])))
    d = pd.DataFrame(rows)
    L = d.len_beats
    res.update(
        lt_045=(L < 0.45).mean(), approx_half=((L >= 0.45) & (L < 0.55)).mean(), half_to_1=((L >= 0.55) & (L < 0.95)).mean(),
        approx_1=((L >= 0.95) & (L < 1.05)).mean(), one_to_2=((L >= 1.05) & (L < 1.95)).mean(), ge_2=(L >= 1.95).mean(),
        official_lt_half=(L < 0.5 - 1e-6).mean(),
        inside_any=((d.inside_same + d.inside_other) > 0).mean(), inside_same=(d.inside_same > 0).mean(), inside_other=(d.inside_other > 0).mean(),
        chord_start=d.chord_start.mean(), after_lt_half=(d.gap_after_release < 0.45).mean(), after_med=d.gap_after_release.median(),
        before_med=d.gap_before.median(), start_on_beat=(d.start_snap == 1).mean(), start_on_half=(d.start_snap == 2).mean(),
        end_on_beat=(d.end_snap == 1).mean(), end_on_half=(d.end_snap == 2).mean(), end_off_half_grid=(~d.end_snap.isin([1, 2])).mean(),
        start_downbeat=d.start_downbeat.mean(), start_bar4_last=(d.start_bar4 == 3).mean())
    return res, rows


R = []
for r in H.itertuples():
    x, _ = per_chart("human", r.set_id)
    x["split"] = r.split
    x["genre"] = r.genre
    x["owner"] = r.owner
    R.append(x)
for r in A.itertuples():
    x, _ = per_chart("algo", r.set_id)
    x["split"] = "algo"
    x["genre"] = r.genre
    R.append(x)
R = pd.DataFrame(R)
R.to_csv(RESULTS / "holds_per_chart.csv", index=False)

lab = {"train": "ludzie trening", "test": "ludzie test", "algo": "algorytm test"}
cols = [("lt_045", "< 0,45 beatu"), ("official_lt_half", "< 1/2 wg metryki (tol. 1e-6)"), ("approx_half", "≈ 1/2 (0,45–0,55)"),
        ("half_to_1", "0,55–0,95"), ("approx_1", "≈ 1 (0,95–1,05)"), ("one_to_2", "1,05–1,95"), ("ge_2", "≥ 1,95"),
        ("inside_any", "z nutą w trakcie"), ("inside_same", "…tej samej ręki"), ("inside_other", "…drugiej ręki"), ("chord_start", "akord na starcie"),
        ("after_lt_half", "następna chwila < 1/2 beatu po puszczeniu"), ("after_med", "odstęp po puszczeniu [beat]"),
        ("before_med", "odstęp przed startem [beat]"), ("start_on_beat", "start na beacie"), ("start_on_half", "start na 1/2"),
        ("end_on_beat", "koniec na beacie"), ("end_on_half", "koniec na 1/2"), ("end_off_half_grid", "koniec poza 1/1 i 1/2"),
        ("start_downbeat", "start na downbeacie"), ("start_bar4_last", "start w 4. takcie bloku")]
rows = []
for c, name in cols:
    cells = [name]
    for sp in ["train", "test", "algo"]:
        sub = R[(R.split == sp) & (R.n_holds >= 3)]
        cells.append(fmt_q(sub[c]))
    rows.append(cells)
n_info = {sp: (R[(R.split == sp) & (R.n_holds >= 3)]) for sp in ["train", "test", "algo"]}
hdr = [f"{lab[sp]} (n={len(v)} map{', ' + str(v.owner.nunique()) + ' mapperów' if sp != 'algo' else ''})" for sp, v in n_info.items()]
out = ["### Holdy na mapę (mapy z ≥ 3 holdami), p10/p50/p90 po mapach\n\n" + md_table(rows, ["cecha holdów"] + hdr)]

# --- regresja: gdzie zaczyna się hold (wśród zmapowanych slotów) -----------------------------------------------------
DET = ["full", "perc", "harm", "low", "lowmid", "highmid", "high", "stem_drums", "stem_bass", "stem_vocals", "stem_other"]
EV = ["kick", "snare", "hat", "perc", "bass", "lead", "low", "lowmid", "highmid", "high"]
frames = []
for df, who in ((H, "human"), (A, "algo")):
    for r in df.itertuples():
        s = slots(who, r.set_id)
        d = pd.DataFrame(s)
        d = d[d.mapped]
        d["set_id"] = r.set_id
        d["grp"] = r.split if who == "human" else "algo"
        frames.append(d)
M = pd.concat(frames, ignore_index=True)
POS = {1: "1/1", 2: "1/2", 4: "1/4", 8: "1/8", 3: "1/3", 6: "1/6"}
X = pd.concat([pd.get_dummies(M.snap.map(POS), prefix="pos").astype(float).drop(columns=["pos_1/8"], errors="ignore"),
               M[["downbeat", "kiai"]].astype(float), pd.get_dummies(M.phrase4_bar, prefix="bar4").astype(float).drop(columns=["bar4_0"]),
               (M.n_notes >= 2).astype(float).rename("chord"),
               M[["rms"]], M[[f"env_{x}" for x in DET]].clip(0, 3), M[[f"onset_{x}" for x in DET]].astype(float), M[[f"ev_{e}" for e in EV]]],
              axis=1).fillna(0)
y = M.hold_start.astype(int)
rows = []
coefs = {}
for g in ["train", "test", "algo"]:
    m = (M.grp == g).values
    sc = StandardScaler().fit(X[m])
    lr = LogisticRegression(C=1.0, max_iter=3000).fit(sc.transform(X[m]), y[m])
    coefs[g] = dict(zip(X.columns, lr.coef_[0]))
    rows.append([lab[g], int(m.sum()), f"{y[m].mean():.3f}"])
out.append("### Start holda wśród zmapowanych slotów\n\n" + md_table(rows, ["grupa", "zmapowanych slotów", "udział startów holda"]))
cf = pd.DataFrame(coefs)
cf = cf.reindex(cf["train"].abs().sort_values(ascending=False).index)
rows = [[k, f"{v['train']:+.2f}", f"{v['test']:+.2f}", f"{v['algo']:+.2f}"] for k, v in cf.head(18).iterrows()]
out.append("#### Regresja logistyczna `hold_start` (osobno na każdej grupie; 18 cech o największym |współczynniku| u ludzi)\n\n" +
           md_table(rows, ["cecha", "ludzie trening", "ludzie test", "algorytm test"]))
(RESULTS / "holds.md").write_text("\n\n".join(out))
print("\n\n".join(out))
