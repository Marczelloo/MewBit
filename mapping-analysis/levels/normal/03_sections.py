"""Sekcje, przejścia, intro/outro, kiai i kontrast na Normal.

Granice: `structure_boundaries_ms` (songs/<set>.json, z audio, na taktach siatki ludzkiej). Takty: downbeaty z tabel slotów.
Dla każdej granicy: nuty na takt w taktach -4..+3 względem taktu granicy, znormalizowane medianą taktów utworu (ten chart).
Kierunek granicy z RMS slotów: średni RMS 4 taktów po / przed (≥ 1,25 w górę, ≤ 0,8 w dół, jak w metrics.md).

Wynik: results/sections.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import RESULTS, algo, fmt, fmt_q, human, md_table, notes, q, slots, song

H = human()
A = algo()
REL = list(range(-4, 4))


def bars_of(set_id):
    t = []
    for who in ("human", "algo"):
        try:
            s = slots(who, set_id)
        except FileNotFoundError:
            continue
        t.append(s["t"][s["downbeat"]])
    db = np.unique(np.round(np.concatenate(t), 1))
    return db


def rms_bars(set_id, edges):
    s = slots("human", set_id)
    idx = np.searchsorted(edges, s["t"], side="right") - 1
    out = np.full(len(edges) - 1, np.nan)
    for b in range(len(edges) - 1):
        m = idx == b
        if m.any():
            out[b] = s["rms"][m].mean()
    return out


def analyse(who, set_id):
    edges = bars_of(set_id)
    n = notes(who, set_id)
    t = n[:, 0]
    per_bar = np.histogram(t, bins=edges)[0].astype(float)
    # takty w czasie aktywnym tego chartu
    first, last = t.min(), np.nanmax(np.where(np.isnan(n[:, 2]), t, n[:, 2]))
    active = (edges[1:] > first) & (edges[:-1] <= last)
    med = np.median(per_bar[active]) if active.any() else np.nan
    rms = rms_bars(set_id, edges)
    # akordy na downbeacie
    times, counts = np.unique(t, return_counts=True)
    rows = []
    for b_ms in song(set_id)["structure_boundaries_ms"]:
        k = int(np.argmin(np.abs(edges - b_ms)))
        if abs(edges[k] - b_ms) > 50 or k < 4 or k + 4 >= len(edges):
            continue
        if not active[k - 4:k + 4].all():
            continue
        dens = per_bar[k - 4:k + 4] / max(med, 1e-9)
        before = per_bar[k - 4:k].sum()
        after = per_bar[k:k + 4].sum()
        r_after = np.nanmean(rms[k:k + 4])
        r_before = np.nanmean(rms[k - 4:k])
        ratio = r_after / max(r_before, 1e-9)
        j = np.argmin(np.abs(times - edges[k]))
        on = abs(times[j] - edges[k]) <= 30
        chord = on and counts[j] >= 2
        # ostatni beat przed granicą: ile chwil w ostatnim takcie przypada na jego 2. połowę
        last_bar = t[(t >= edges[k - 1]) & (t < edges[k])]
        half = edges[k - 1] + (edges[k] - edges[k - 1]) / 2
        rows.append(dict(set_id=set_id, who=who, boundary_ms=edges[k], dir="w górę" if ratio >= 1.25 else "w dół" if ratio <= 0.8 else "płasko",
                         rms_ratio=ratio, after_over_before=after / max(before, 1), last_over_prev3=per_bar[k - 1] / max(per_bar[k - 4:k - 1].mean(), 1e-9),
                         note_on=on, chord_on=chord, last_bar_second_half_share=np.mean(last_bar >= half) if len(last_bar) else np.nan,
                         **{f"bar{r:+d}": dens[i] for i, r in enumerate(REL)}))
    # intro / outro: pierwsze i ostatnie 4 takty aktywne względem mediany
    act = np.where(active)[0]
    intro = per_bar[act[:4]].mean() / max(med, 1e-9) if len(act) >= 8 else np.nan
    outro = per_bar[act[-4:]].mean() / max(med, 1e-9) if len(act) >= 8 else np.nan
    # gęstość taktu a RMS taktu (Spearman) i kontrast cichych/głośnych taktów
    ok = active & np.isfinite(rms)
    from scipy.stats import spearmanr
    rho = spearmanr(per_bar[ok], rms[ok]).statistic if ok.sum() > 5 else np.nan
    qlo, qhi = np.nanquantile(rms[ok], [0.25, 0.75]) if ok.sum() > 8 else (np.nan, np.nan)
    quiet = per_bar[ok & (rms <= qlo)].mean() / max(med, 1e-9) if ok.sum() > 8 else np.nan
    loud = per_bar[ok & (rms >= qhi)].mean() / max(med, 1e-9) if ok.sum() > 8 else np.nan
    return rows, dict(set_id=set_id, who=who, intro=intro, outro=outro, first_ms=first, rho_rms=rho, quiet_q1=quiet, loud_q4=loud,
                      first_bar_ms=edges[act[0]] if len(act) else np.nan)


B, S = [], []
for r in H.itertuples():
    rows, summ = analyse("human", r.set_id)
    for x in rows:
        x["split"] = r.split
        x["genre"] = r.genre
    summ["split"] = r.split
    summ["genre"] = r.genre
    B += rows
    S.append(summ)
for r in A.itertuples():
    rows, summ = analyse("algo", r.set_id)
    for x in rows:
        x["split"] = "algo"
        x["genre"] = r.genre
    summ["split"] = "algo"
    summ["genre"] = r.genre
    B += rows
    S.append(summ)
B = pd.DataFrame(B)
S = pd.DataFrame(S)
B.to_csv(RESULTS / "sections_boundaries.csv", index=False)
S.to_csv(RESULTS / "sections_songs.csv", index=False)

out = []
lab = {"train": "ludzie trening", "test": "ludzie test", "algo": "algorytm test"}
rows = []
for sp in ["train", "test", "algo"]:
    for d in ["w górę", "w dół", "płasko"]:
        sub = B[(B.split == sp) & (B.dir == d)]
        if len(sub) == 0:
            continue
        # mediana per utwór, potem kwantyle po utworach (żeby utwory z wieloma granicami nie dominowały)
        per = sub.groupby("set_id")[[f"bar{r:+d}" for r in REL]].median()
        cells = [lab[sp], d, f"{len(sub)} / {sub.set_id.nunique()}"] + [fmt(per[f"bar{r:+d}"].median()) for r in REL]
        rows.append(cells)
out.append("### Gęstość taktów wokół granic sekcji (nuty w takcie / mediana taktu chartu; mediana median utworów)\n\n"
           "Takt 0 = pierwszy takt nowej sekcji.\n\n" + md_table(rows, ["grupa", "kierunek RMS", "granic / utworów"] + [f"takt {r:+d}" for r in REL]))

rows = []
for sp in ["train", "test", "algo"]:
    sub = B[B.split == sp]
    per = sub.groupby("set_id").agg(note_on=("note_on", "mean"), chord_on=("chord_on", "mean"), aob=("after_over_before", "median"),
                                    lop=("last_over_prev3", "median"), half=("last_bar_second_half_share", "median"))
    up = sub[sub.dir == "w górę"].groupby("set_id").after_over_before.median()
    dn = sub[sub.dir == "w dół"].groupby("set_id").after_over_before.median()
    rows.append([lab[sp], f"{len(sub)} / {sub.set_id.nunique()}", fmt_q(per.note_on), fmt_q(per.chord_on), fmt_q(per.aob), fmt_q(up), fmt_q(dn), fmt_q(per.lop),
                 fmt_q(per.half)])
out.append("### Granice sekcji: co dzieje się na granicy i tuż przed nią (rozrzut między utworami p10/p50/p90)\n\n" +
           md_table(rows, ["grupa", "granic / utworów", "nuta na downbeacie granicy", "akord na downbeacie granicy", "nuty 4 takty po/przed",
                           "po/przed, granice w górę", "po/przed, granice w dół", "ostatni takt / 3 wcześniejsze", "udział chwil ostatniego taktu w jego 2. połowie"]))

rows = []
for sp in ["train", "test", "algo"]:
    sub = S[S.split == sp]
    rows.append([lab[sp], len(sub), fmt_q(sub.intro), fmt_q(sub.outro), fmt_q(sub.rho_rms), fmt_q(sub.quiet_q1), fmt_q(sub.loud_q4),
                 fmt_q(sub.first_ms / 1000)])
out.append("### Intro, outro i kontrast głośności (na utwór, p10/p50/p90)\n\n"
           "intro/outro = średnia nut w pierwszych/ostatnich 4 taktach aktywnych / mediana taktu; ρ = Spearman nut w takcie z RMS taktu; "
           "ciche/głośne = średnia nut w taktach z dolnego/górnego kwartyla RMS / mediana taktu.\n\n" +
           md_table(rows, ["grupa", "utworów", "intro", "outro", "ρ nuty~RMS taktu", "ciche takty (Q1 RMS)", "głośne takty (Q4 RMS)", "pierwsza nuta [s]"]))

# test vs algo per utwór: granice z nutą
pair = B[B.split.isin(["test", "algo"])].groupby(["set_id", "split"]).note_on.mean().unstack()
out.append(f"Granice z nutą na downbeacie, ta sama piosenka: ludzie test mediana {pair['test'].median():.2f}, algorytm {pair['algo'].median():.2f} "
           f"(algorytm niżej w {(pair['algo'] < pair['test']).sum()}/{len(pair)} utworach).")
(RESULTS / "sections.md").write_text("\n\n".join(out))
print("\n\n".join(out))
