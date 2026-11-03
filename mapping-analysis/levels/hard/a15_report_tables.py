"""Tabele do REPORT.md (sekcja 5): ludzie vs algorytm na zbiorze testowym, ogółem i w podziale na gatunki.
Wypisuje tabele markdown na stdout i zapisuje tables/report_table_test.csv, tables/report_table_genre.csv.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from scipy import stats

from common import BIG_GENRES, TABLES, algo, human

h = human()
a = algo()
ids = sorted(set(a.set_id))
ht = h[h.set_id.isin(ids)].set_index("set_id").loc[ids]
at = a.set_index("set_id").loc[ids]
htr = h[h.split == "train"].set_index("set_id")


def add(df, src, who):
    t = pd.read_csv(f"{TABLES}/{src}")
    t = t[t.who == who].set_index("set_id")
    return t


aux = {}
for who in ["human", "algo"]:
    sl = add(None, "slot_rates_per_song.csv", who)
    pt = add(None, "patterns_per_chart.csv", who)
    ho = add(None, "holds_per_chart.csv", who)
    rb = add(None, "robust_rhythm.csv", who)
    rd = pd.read_csv(f"{TABLES}/robust_repetition_diff.csv")
    rd = rd[rd.who == who].set_index("set_id")
    df = pd.DataFrame(index=sl.index)
    for c in ["rate_1/1", "rate_1/2", "rate_1/4", "rate_1/8", "chord_rate_1/1"]:
        df[c] = sl[c]
    df["one_hand_jump"] = pt["chord2_jedna ręka L"] + pt["chord2_jedna ręka P"]
    df["hand_dev4bar_p50"] = pt["hand_dev4bar_p50"]
    df["release_on_1_4"] = ho["release_on_1_4"]
    df["q:gap_other"] = rb["gap_other"]
    df["q:gap_3/4"] = rb["gap_3/4"]
    df["q:run_le_1/2_max"] = rb["run_le_1/2_max"]
    df["rep_rhythm_diff"] = rd["rhythm_diff"]
    df["rep_lanes_diff"] = rd["lanes_diff"]
    aux[who] = df
for c in aux["human"].columns:
    ht[c] = aux["human"][c].reindex(ids).values
    at[c] = aux["algo"][c].reindex(ids).values
    htr[c] = aux["human"][c].reindex(htr.index).values

KEY = [
    ("nps", "nuty/s"), ("notes_per_beat", "nuty/beat"), ("moments_per_beat", "chwile/beat"), ("nps_peak8s", "szczyt 8 s, nuty/s"),
    ("chord_share", "udział akordów"), ("chord_size_share.3", "akordy 3-nutowe"), ("chord2_split_hands_share", "akordy 2-nut. na 2 ręce"),
    ("one_hand_jump", "skoki jednej ręki (pomocn.)"), ("chord_rate_1/1", "akord na zmapowanym beacie (sloty)"),
    ("sections.boundary_chord_share", "akord na downbeacie granicy sekcji"),
    ("rate_1/1", "beaty zmapowane (sloty)"), ("rate_1/2", "półbeaty zmapowane (sloty)"), ("rate_1/4", "sloty 1/4 zmapowane"),
    ("rate_1/8", "sloty 1/8 zmapowane"), ("downbeats_carried", "downbeaty z nutą"),
    ("snap_share.16", "chwile na 1/16"), ("snap_share.off", "chwile poza siatką"), ("grid_error_ms.p50", "błąd siatki p50, ms"),
    ("q:gap_other", "odstępy 'other' po kwantyzacji"), ("q:gap_3/4", "odstępy 3/4 po kwantyzacji"),
    ("run_1/2.max_notes", "najdł. seria 1/2"), ("q:run_le_1/2_max", "najdł. ciąg odstępów <= 1/2 (kwant.)"),
    ("hold_share", "udział holdów"), ("hold_len_beats.p50", "długość holda p50, beaty"), ("release_on_1_4", "puszczenia na siatce 1/4"),
    ("holds_with_notes_inside_share", "holdy z nutą w środku"), ("other_hand_notes_per_beat_in_hold.p50", "nuty drugiej ręki/beat w holdzie p50"),
    ("left_hand_share", "lewa ręka"), ("hand_dev4bar_p50", "odchylenie rąk w 4 taktach p50"), ("trill_share", "tryle"),
    ("single_step_share.0", "kolejne pojedyncze na tym samym torze"), ("pattern4_distinct_per_100", "różne układy 4 chwil/100"),
    ("alignment.perc.share", "chwile na onsecie perkusyjnym"), ("alignment.no_sound_share", "chwile bez dźwięku"),
    ("plugin_events.lead.recall", "recall leadu"), ("plugin_events.bass.recall", "recall basu"), ("plugin_events.hat.recall", "recall hi-hatu"),
    ("rep_rhythm_diff", "rytm: powtórzenie - baza (pomocn.)"), ("rep_lanes_diff", "tory: powtórzenie - baza (pomocn.)"),
    ("kiai_density_ratio", "gęstość kiai / reszta"), ("bar_notes_cv", "CV nut na takt"), ("phrase4_notes_p90_over_p10", "kontrast 4 taktów p90/p10"),
    ("rests_ge_2b.per_min", "przerwy >= 2 beaty / min"), ("empty_bar_share", "puste takty"),
]
rows = []
for m, label in KEY:
    hv, av = ht[m].astype(float), at[m].astype(float)
    ok = hv.notna() & av.notna()
    d = (av - hv)[ok]
    p = stats.wilcoxon(d).pvalue if (d != 0).sum() >= 6 else np.nan
    tq = htr[m].astype(float).dropna()
    rows.append(dict(metric=m, label=label, n=int(ok.sum()),
                     h10=hv.quantile(0.1), h50=hv.median(), h90=hv.quantile(0.9), a10=av.quantile(0.1), a50=av.median(), a90=av.quantile(0.9),
                     tr10=tq.quantile(0.1), tr90=tq.quantile(0.9), outside=float(((av < tq.quantile(0.1)) | (av > tq.quantile(0.9)))[av.notna()].mean()), p=p))
T = pd.DataFrame(rows)
T.to_csv(f"{TABLES}/report_table_test.csv", index=False)


def f(x):
    if pd.isna(x):
        return "–"
    ax = abs(x)
    s = f"{x:.0f}" if ax >= 100 else f"{x:.1f}" if ax >= 10 else f"{x:.2f}" if ax >= 0.1 or x == 0 else f"{x:.3f}"
    return s.replace(".", ",")


print("| metryka | ludzie test p10 / p50 / p90 | algorytm p10 / p50 / p90 | ludzie trening p10–p90 | algorytm poza p10–p90 treningu | Wilcoxon p |")
print("|---|---|---|---|---|---|")
for _, r in T.iterrows():
    p = "–" if pd.isna(r.p) else (f"{r.p:.0e}" if r.p < 0.001 else f"{r.p:.3f}".replace(".", ","))
    print(f"| {r.label} (`{r.metric}`) | {f(r.h10)} / {f(r.h50)} / {f(r.h90)} | {f(r.a10)} / {f(r.a50)} / {f(r.a90)} | {f(r.tr10)}–{f(r.tr90)} | {int(round(r.outside * 100))}% | {p} |")

G = []
GKEY = ["nps", "chord_share", "chord_rate_1/1", "rate_1/2", "rate_1/8", "q:gap_other", "q:run_le_1/2_max", "snap_share.16", "hold_len_beats.p50",
        "release_on_1_4", "holds_with_notes_inside_share", "left_hand_share", "trill_share", "alignment.perc.share", "plugin_events.lead.recall",
        "sections.boundary_chord_share"]
print()
hdr = "| metryka (mediana) | " + " | ".join(f"{g} (n={int((ht.genre4 == g).sum())})" for g in BIG_GENRES + ["other"]) + " |"
print(hdr)
print("|---" * (len(BIG_GENRES) + 2) + "|")
for m in GKEY:
    cells = []
    for g in BIG_GENRES + ["other"]:
        sel = ht.genre4 == g
        hv, av = ht.loc[sel, m].median(), at.loc[sel, m].median()
        cells.append(f"{f(hv)} → {f(av)}")
        G.append(dict(metric=m, genre=g, n=int(sel.sum()), human_p50=hv, algo_p50=av))
    print(f"| `{m}` | " + " | ".join(cells) + " |")
pd.DataFrame(G).to_csv(f"{TABLES}/report_table_genre.csv", index=False)
