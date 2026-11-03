"""Tabele do REPORT.md (sekcja 5): ludzie vs algorytm na zbiorze testowym, ogółem i w podziale na gatunki.
Wypisuje tabele markdown na stdout i zapisuje tables/report_table_test.csv, tables/report_table_genre.csv.
"""
import os, sys, warnings
warnings.filterwarnings("ignore")
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
    df["aux_rep_rhythm_diff"] = rd["rhythm_diff"]
    df["aux_rep_lanes_diff"] = rd["lanes_diff"]
    aux[who] = df
for d in (ht, at, htr):
    d["one_hand_jump_off"] = 1 - d["chord2_split_hands_share"]
    d["rep_rhythm_diff"] = d["repetition.repeat.rhythm"] - d["repetition.baseline.rhythm"]
    d["rep_lanes_diff"] = d["repetition.repeat.lanes"] - d["repetition.baseline.lanes"]
    d["rep_mirror_diff"] = d["repetition.repeat.lanes_or_mirror"] - d["repetition.baseline.lanes_or_mirror"]
for c in aux["human"].columns:
    ht[c] = aux["human"][c].reindex(ids).values
    at[c] = aux["algo"][c].reindex(ids).values
    htr[c] = aux["human"][c].reindex(htr.index).values

KEY = [
    ("nps", "nuty/s"), ("notes_per_beat", "nuty/beat"), ("moments_per_beat", "chwile/beat"), ("nps_peak8s", "szczyt 8 s, nuty/s"),
    ("versus_human.recall", "chwile człowieka trafione przez algorytm (±40 ms)"), ("versus_human.precision", "chwile algorytmu trafiające w chwile człowieka"),
    ("chord_share", "udział akordów"), ("chord_size_share.3", "akordy 3-nutowe"), ("chord2_split_hands_share", "akordy 2-nut. na 2 ręce"),
    ("chord_position_share.offbeat", "akordy poza beatem"), ("chord_rate_on_mapped_beats", "akord na zmapowanym beacie"),
    ("chords_in_half_runs_per_min", "akordy w seriach 1/2 na min"),
    ("sections.boundary_chord_share", "akord na downbeacie granicy sekcji"), ("sections.boundary_note_share", "nuta na downbeacie granicy sekcji"),
    ("kiai_start.chord_share", "akord na początku kiai"), ("sections.bar_chords_vs_rms_spearman", "akordy w takcie a RMS (Spearman)"),
    ("coverage.beat", "beaty z chwilą (tolerancja źródła)"), ("rate_1/1", "beaty z chwilą (sloty chosen, ±25 ms)"),
    ("coverage.half", "półbeaty z chwilą"), ("coverage.quarter", "punkty 1/4 z chwilą"), ("coverage.beat_kiai", "beaty z chwilą w kiai"),
    ("rate_1/8", "sloty 1/8 z chwilą (chosen)"), ("downbeats_carried", "downbeaty z nutą"),
    ("snap_share.8", "chwile na 1/8"), ("snap_share.16", "chwile na 1/16"), ("snap_share.off", "chwile poza siatką"),
    ("grid_error_ms.p50", "błąd siatki p50, ms"), ("versus_human.grid_offset_ms.p50", "przesunięcie do siatki człowieka p50, ms"),
    ("versus_human.grid_offset_ms.abs_over_10ms_share", "chwile > 10 ms od siatki człowieka"),
    ("gap_share.1/2", "odstępy 1/2"), ("gap_share.1/4", "odstępy 1/4"), ("gap_share.3/4", "odstępy 3/4"), ("gap_share.other", "odstępy 'other'"),
    ("q:gap_other", "odstępy 'other' po kwantyzacji do 1/8 (pomocn.)"),
    ("run_1/2.max_notes", "najdł. seria 1/2"), ("run_1/2.count_per_min", "serie 1/2 na min"), ("fast_runs_1_4_or_finer.max_notes", "najdł. seria <= 1/4"),
    ("q:run_le_1/2_max", "najdł. ciąg odstępów <= 1/2 (pomocn.)"),
    ("hold_share", "udział holdów"), ("hold_len_beats.p50", "długość holda p50, beaty"), ("hold_short_share.lt_1", "holdy < 0,95 beatu"),
    ("release_on_1_4", "puszczenia na siatce 1/4"), ("holds_context.release_at_next_moment_share", "puszczenie przy następnej chwili"),
    ("holds_context.start_on_beat_share", "start holda na beacie"), ("holds_context.head_in_chord_share", "głowa holda w akordzie"),
    ("holds_with_notes_inside_share", "holdy z nutą w środku"), ("holds_context.notes_inside_share_by_length.1", "nuta w środku holda 3/4-1,5 beatu"),
    ("other_hand_notes_per_beat_in_hold.p50", "nuty drugiej ręki/beat w holdzie p50"),
    ("left_hand_share", "lewa ręka"), ("hand_balance_4bar.p50", "odchylenie rąk w 4 taktach p50"), ("hand_balance_4bar.over_0_2_share", "okna 4 taktów > 70/30"),
    ("hand_by_class.kick.left_share", "stopa: lewa ręka"), ("hand_by_class.snare.left_share", "werbel: lewa ręka"), ("hand_by_class.lead.left_share", "lead: lewa ręka"),
    ("trill_share", "tryle (trójki x-y-x)"), ("trills.max_notes", "najdłuższy tryl"), ("trills.runs_per_min", "tryle na min"),
    ("single_step_share.0", "kolejne pojedyncze na tym samym torze"), ("pattern4_distinct_per_100", "różne układy 4 chwil/100"),
    ("anchor_rc_max_notes", "anchor (definicja RC)"),
    ("alignment.perc.share", "chwile na onsecie perkusyjnym"), ("alignment.no_sound_share", "chwile bez dźwięku"),
    ("plugin_events.lead.recall", "recall leadu"), ("plugin_events.bass.recall", "recall basu"), ("plugin_events.hat.recall", "recall hi-hatu"),
    ("repetition.repeat.rhythm", "rytm w powtórzeniach muzyki"), ("repetition.baseline.rhythm", "rytm w linii bazowej"),
    ("rep_rhythm_diff", "rytm: powtórzenie - baza"), ("rep_mirror_diff", "tory (z lustrem): powtórzenie - baza"),
    ("kiai_density_ratio", "gęstość kiai / reszta"), ("sections.bar_density_vs_rms_spearman", "gęstość taktu a RMS"),
    ("bar_notes_cv", "CV nut na takt"), ("phrase4_notes_p90_over_p10", "kontrast 4 taktów p90/p10"),
    ("rests_ge_2b.per_min", "przerwy >= 2 beaty / min"), ("empty_bar_share", "puste takty"), ("first_ms", "pierwsza nuta, ms"),
]
rows = []
for m, label in KEY:
    nan = pd.Series(np.nan, index=at.index)
    hv = ht[m].astype(float) if m in ht.columns else nan
    av = at[m].astype(float)
    ok = hv.notna() & av.notna()
    d = (av - hv)[ok]
    p = stats.wilcoxon(d).pvalue if (d != 0).sum() >= 6 else np.nan
    tq = htr[m].astype(float).dropna() if m in htr.columns else pd.Series([np.nan])
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
GKEY = ["nps", "chord_share", "chord_rate_on_mapped_beats", "coverage.beat", "coverage.half", "rate_1/8", "gap_share.other", "q:run_le_1/2_max",
        "versus_human.recall", "snap_share.16", "hold_len_beats.p50", "holds_context.release_at_next_moment_share", "holds_with_notes_inside_share",
        "hand_balance_4bar.p50", "hand_by_class.kick.left_share", "trills.max_notes", "alignment.perc.share", "plugin_events.lead.recall",
        "sections.boundary_chord_share", "kiai_start.chord_share", "rep_rhythm_diff"]
print()
hdr = "| metryka (mediana) | " + " | ".join(f"{g} (n={int((ht.genre4 == g).sum())})" for g in BIG_GENRES + ["other"]) + " |"
print(hdr)
print("|---" * (len(BIG_GENRES) + 2) + "|")
for m in GKEY:
    cells = []
    for g in BIG_GENRES + ["other"]:
        sel = ht.genre4 == g
        hv = ht.loc[sel, m].median() if m in ht.columns else np.nan
        av = at.loc[sel, m].median()
        cells.append(f"{f(hv)} → {f(av)}")
        G.append(dict(metric=m, genre=g, n=int(sel.sum()), human_p50=hv, algo_p50=av))
    print(f"| `{m}` | " + " | ".join(cells) + " |")
pd.DataFrame(G).to_csv(f"{TABLES}/report_table_genre.csv", index=False)
