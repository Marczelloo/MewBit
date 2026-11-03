"""Profil metryk Normal: ludzie (trening, test) i algorytm (test), reguły, zależność od BPM.

Wynik: results/profile_metrics.csv, results/profile_metrics.md, results/rules.md, results/bpm.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from scipy import stats

from common import RESULTS, algo, fmt, human, md_table, q

H = human()
A = algo()
TR = H[H.split == "train"]
TE = H[H.split == "test"]
TE = TE.set_index("set_id").loc[A.set_id].reset_index()  # ta sama kolejność co algorytm

METRICS = [
    # gęstość
    "nps", "mps", "notes_per_beat", "moments_per_beat", "nps_window.p10", "nps_window.p50", "nps_window.p90", "nps_window.max", "nps_peak8s",
    # rytm
    "snap_share.1", "snap_share.2", "snap_share.4", "snap_share.3", "snap_share.6", "snap_share.8", "snap_share.off", "triplet_share",
    "on_beat_share", "on_downbeat_share", "downbeats_carried",
    "gap_share.2", "gap_share.3/2", "gap_share.1", "gap_share.3/4", "gap_share.1/2", "gap_share.1/3", "gap_share.1/4", "gap_share.1/6", "gap_share.other",
    "gap_ms.min", "gap_ms.p5", "gap_ms.p50", "gap_beats.p5", "gap_beats.p25", "gap_beats.p50", "gap_beats.p75",
    "run_1/1.count_per_min", "run_1/1.max_notes", "run_1/2.count_per_min", "run_1/2.max_notes", "run_1/2.p90_notes",
    "run_1/4.count_per_min", "run_1/4.max_notes", "run_1/4.p90_notes", "run_1/6.count_per_min", "run_1/6.max_notes", "run_1/3.max_notes",
    "fast_runs_1_4_or_finer.count_per_min", "fast_runs_1_4_or_finer.max_notes",
    # akordy
    "chord_share", "chord_size_share.2", "chord_size_share.3", "chord_size_share.4", "chord_position_share.downbeat",
    "chord_position_share.beat", "chord_position_share.offbeat", "chord2_split_hands_share", "chords_in_fast_stream_per_min",
    # jacki
    "minijack_share", "minijack_gap_beats.p10", "minijack_gap_beats.p50", "minijack_fast_share", "jack_max_notes", "anchor_max_notes",
    # holdy
    "hold_share", "hold_len_beats.p10", "hold_len_beats.p50", "hold_len_beats.p90", "hold_short_share.lt_1_2", "hold_short_share.lt_1",
    "holds_with_notes_inside_share", "other_hand_notes_per_beat_in_hold.p50", "other_hand_notes_per_beat_in_hold.p90",
    "release_gap_beats.p5", "release_gap_beats.p50", "release_snap_share.1", "release_snap_share.2", "release_snap_share.4", "release_snap_share.off",
    "max_simultaneous_holds",
    # tory i wzorce
    "left_hand_share", "lane_share.0", "lane_share.1", "lane_share.2", "lane_share.3",
    "single_step_share.0", "single_step_share.1", "single_step_share.2", "single_step_share.3", "hand_switch_share",
    "trill_share", "stair_share", "pattern4_entropy_bits", "pattern4_distinct_per_100",
    # pauzy i kontrast
    "rests_ge_2b.per_min", "rests_ge_2b.time_share", "rests_ge_4b.per_min", "rests_ge_4b.time_share", "rests_ge_8b.per_min",
    "rests_ge_8b.time_share", "longest_rest_beats", "bar_notes.p10", "bar_notes.p50", "bar_notes.p90", "bar_notes_cv",
    "phrase4_notes_p90_over_p10", "empty_bar_share", "kiai_density_ratio",
    # muzyka pod nutą
    "alignment.full.share", "alignment.perc.share", "alignment.harm.share", "alignment.low.share", "alignment.lowmid.share",
    "alignment.highmid.share", "alignment.high.share", "alignment.stem_drums.share", "alignment.stem_bass.share",
    "alignment.stem_vocals.share", "alignment.stem_other.share", "alignment.no_sound_share",
    "plugin_events.kick.recall", "plugin_events.kick.recall_strong", "plugin_events.snare.recall", "plugin_events.snare.recall_strong",
    "plugin_events.hat.recall", "plugin_events.perc.recall", "plugin_events.bass.recall", "plugin_events.bass.recall_strong",
    "plugin_events.lead.recall", "plugin_events.lead.recall_strong", "plugin_events.low.recall", "plugin_events.lowmid.recall",
    "plugin_events.highmid.recall", "plugin_events.high.recall",
    "plugin_events.kick.moment_share", "plugin_events.snare.moment_share", "plugin_events.hat.moment_share", "plugin_events.perc.moment_share",
    "plugin_events.bass.moment_share", "plugin_events.lead.moment_share",
    # powtarzalność
    "repetition.repeat_pairs", "repetition.repeat.rhythm", "repetition.repeat.lanes", "repetition.repeat.lanes_or_mirror",
    "repetition.baseline.rhythm", "repetition.baseline.lanes", "repetition.baseline.lanes_or_mirror",
    # sekcje
    "sections.n_boundaries", "sections.bar_density_vs_rms_spearman", "sections.bar_density_vs_onset_rate_spearman",
    "sections.boundary_after_over_before_median", "sections.boundary_last_bar_over_prev3_median",
    "sections.boundary_note_share", "sections.boundary_chord_share",
    "sections.boundary_rising_density_ratio_median", "sections.boundary_falling_density_ratio_median",
]

# Metryki v2 (shared/metrics.md, „Dodane i poprawione po etapie 2”).
METRICS += [
    "coverage.beat", "coverage.half", "coverage.quarter", "coverage.beat_kiai", "coverage.beat_no_kiai", "chord_rate_on_mapped_beats",
    "chords_in_half_runs_per_min", "chord_pairs_in_quarter_streams.pairs", "chord_pairs_in_quarter_streams.closer_than_1_beat_share",
    "hand_balance_4bar.p50", "hand_balance_4bar.p90", "hand_balance_4bar.over_0_2_share",
    "trills.max_notes", "trills.ge10_per_min", "trills.one_hand_share", "trills.runs_per_min", "anchor_rc_max_notes",
    "holds_context.release_at_next_moment_share", "holds_context.start_on_beat_share", "holds_context.head_in_chord_share",
    "holds_context.notes_inside_share_by_length.1/2", "holds_context.notes_inside_share_by_length.1", "holds_context.notes_inside_share_by_length.2+",
    "holds_context.holds_by_length.1/2", "holds_context.holds_by_length.1", "holds_context.holds_by_length.2+", "holds_context.shield_1_4_per_min",
    "kiai_start.n", "kiai_start.note_share", "kiai_start.chord_share",
    "sections.bar_chords_vs_rms_spearman", "sections.boundary_empty_last_beat_share",
    "rest_context.rests_ge_4b", "rest_context.loud_share", "rest_context.rms_p50", "rest_context.at_boundary_share",
    "hand_by_class.kick.left_share", "hand_by_class.snare.left_share", "hand_by_class.hat.left_share", "hand_by_class.bass.left_share",
    "hand_by_class.lead.left_share",
] + [f"sections.boundary_profile_{k}.{i}" for k in ("rising", "falling") for i in range(8)] + [
    "versus_human.precision", "versus_human.recall", "versus_human.lane_overlap_on_matched", "versus_human.grid_offset_ms.p10",
    "versus_human.grid_offset_ms.p50", "versus_human.grid_offset_ms.p90", "versus_human.grid_offset_ms.abs_over_10ms_share",
]
METRICS = [m for m in METRICS if m in H.columns or m in A.columns]
for m in METRICS:
    for df in (H, A):
        if m not in df:
            df[m] = np.nan

# Pochodne pomocnicze (z istniejących metryk, bez nowych definicji).
for df in (H, A):
    df["chord_size_share.3+"] = df["chord_size_share.3"].fillna(0) + df["chord_size_share.4"].fillna(0)
    df["snap_share.1+2"] = df["snap_share.1"].fillna(0) + df["snap_share.2"].fillna(0)
    df["gap_share.ge_1/2"] = sum(df.get(f"gap_share.{k}", pd.Series(0, index=df.index)).fillna(0)
                                 for k in ["8", "6", "4", "3", "2", "3/2", "1", "3/4", "1/2"])
    df["repetition.rhythm_minus_base"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]
    df["repetition.lanes_minus_base"] = df["repetition.repeat.lanes"] - df["repetition.baseline.lanes"]
    df["hold_moment_share"] = df["n_holds"] / df["n_moments"]
METRICS += ["chord_size_share.3+", "snap_share.1+2", "gap_share.ge_1/2", "repetition.rhythm_minus_base", "repetition.lanes_minus_base"]
TR = H[H.split == "train"]
TE = H[H.split == "test"].set_index("set_id").loc[A.set_id].reset_index()


def row(m):
    tr = pd.to_numeric(TR[m], errors="coerce")
    te = pd.to_numeric(TE[m], errors="coerce")
    al = pd.to_numeric(A[m], errors="coerce") if m in A else pd.Series(np.nan, index=A.index)
    p10, p50, p90 = q(tr)
    lo, hi = q(tr, (5, 95))
    t10, t50, t90 = q(te)
    a10, a50, a90 = q(al)
    # para (ten sam utwór): Wilcoxon algorytm vs człowiek na teście
    pair = pd.DataFrame({"h": te.values, "a": al.values}).dropna()
    try:
        w = stats.wilcoxon(pair.a, pair.h).pvalue if len(pair) >= 6 and (pair.a != pair.h).any() else np.nan
    except ValueError:
        w = np.nan
    try:
        mw = stats.mannwhitneyu(tr.dropna(), te.dropna()).pvalue if te.notna().sum() >= 5 else np.nan
    except ValueError:
        mw = np.nan
    outside = int(((al < p10) | (al > p90)).sum()) if al.notna().any() else np.nan
    below = int((al < p10).sum()) if al.notna().any() else np.nan
    above = int((al > p90).sum()) if al.notna().any() else np.nan
    return dict(metric=m, n_train=int(tr.notna().sum()), tr_p5=lo, tr_p10=p10, tr_p50=p50, tr_p90=p90, tr_p95=hi,
                tr_min=tr.min(), tr_max=tr.max(), n_test=int(te.notna().sum()), te_p10=t10, te_p50=t50, te_p90=t90,
                mw_train_vs_test_p=mw, n_algo=int(al.notna().sum()), al_p10=a10, al_p50=a50, al_p90=a90,
                algo_vs_human_test_wilcoxon_p=w, algo_below_train_p10=below, algo_above_train_p90=above,
                algo_outside_train_p10_p90=outside,
                median_diff_algo_minus_human=float((pair.a - pair.h).median()) if len(pair) else np.nan)


prof = pd.DataFrame([row(m) for m in METRICS])
prof.to_csv(RESULTS / "profile_metrics.csv", index=False)

rows = []
for r in prof.itertuples():
    rows.append([r.metric, r.n_train, f"{fmt(r.tr_p10)} / {fmt(r.tr_p50)} / {fmt(r.tr_p90)}", f"{fmt(r.tr_min)}–{fmt(r.tr_max)}",
                 f"{fmt(r.te_p10)} / {fmt(r.te_p50)} / {fmt(r.te_p90)}", fmt(r.mw_train_vs_test_p, 3),
                 f"{fmt(r.al_p10)} / {fmt(r.al_p50)} / {fmt(r.al_p90)}", f"{r.algo_below_train_p10}↓ {r.algo_above_train_p90}↑",
                 fmt(r.algo_vs_human_test_wilcoxon_p, 3)])
(RESULTS / "profile_metrics.md").write_text(md_table(rows, [
    "metryka", "n tr", "ludzie trening p10/p50/p90", "min–max tr", "ludzie test p10/p50/p90", "MW tr vs te p",
    "algorytm test p10/p50/p90", "algo poza p10–p90 tr", "Wilcoxon algo vs ludzie (test) p"]))

# --- Reguły: predykat na mapę, udział map, które go spełniają ------------------------------------------------
def nn(col, cond):
    """Reguła liczona tylko na mapach, które mają wartość metryki (NaN = nie dotyczy)."""
    return lambda d: cond(d[col]).where(d[col].notna())


RULES = [
    ("RC: akordy ≤ 2 nuty (udział chwil 3+ = 0)", lambda d: d["chord_size_share.3+"] == 0),
    ("akordy 3+ ≤ 1% chwil", lambda d: d["chord_size_share.3+"] <= 0.01),
    ("RC: ≤ 5 kolejnych nut 1/4 (run_1/4.max_notes ≤ 5)", lambda d: d["run_1/4.max_notes"].fillna(0) <= 5),
    ("run_1/4.max_notes ≤ 3", lambda d: d["run_1/4.max_notes"].fillna(0) <= 3),
    ("RC: brak serii 1/6 (run_1/6.max_notes ≤ 2)", lambda d: d["run_1/6.max_notes"].fillna(0) <= 2),
    ("brak odstępów 1/6 w ogóle (gap_share.1/6 = 0)", lambda d: d["gap_share.1/6"].fillna(0) == 0),
    ("szybkie serie ≤ 1/4 maks. ≤ 5 nut", lambda d: d["fast_runs_1_4_or_finer.max_notes"].fillna(0) <= 5),
    ("RC: hold ≥ 1/2 beatu (hold_short_share.lt_1_2 = 0)", lambda d: d["hold_short_share.lt_1_2"].fillna(0) == 0),
    ("hold < 1/2 beatu ≤ 5% holdów", lambda d: d["hold_short_share.lt_1_2"].fillna(0) <= 0.05),
    ("RC: puszczenia ≥ 1/2 beatu od siebie (release_gap_beats.p5 ≥ 0,49)", lambda d: d["release_gap_beats.p5"].fillna(9) >= 0.49),
    ("RC: brak akordów w serii 1/4 (chords_in_fast_stream_per_min = 0)", lambda d: d["chords_in_fast_stream_per_min"].fillna(0) == 0),
    ("akordy w serii 1/4 ≤ 0,5/min", lambda d: d["chords_in_fast_stream_per_min"].fillna(0) <= 0.5),
    ("RC: anchor ≤ 2 nuty (anchor_max_notes ≤ 2)", lambda d: d["anchor_max_notes"] <= 2),
    ("anchor ≤ 3 nuty", lambda d: d["anchor_max_notes"] <= 3),
    ("RC: brak minijacków 1/4 (minijack_fast_share = 0)", lambda d: d["minijack_fast_share"].fillna(0) == 0),
    ("minijacki 1/4 ≤ 5% minijacków", lambda d: d["minijack_fast_share"].fillna(0) <= 0.05),
    ("RC: brak jacków (jack_max_notes ≤ 2)", lambda d: d["jack_max_notes"] <= 2),
    ("jack ≤ 3 nuty", lambda d: d["jack_max_notes"] <= 3),
    ("RC: przewaga 1/1 i 1/2 (udział odstępów ≥ 1/2 beatu ≥ 0,75)", lambda d: d["gap_share.ge_1/2"] >= 0.75),
    ("chwile na beacie lub półbeacie ≥ 0,85 (snap 1+2)", lambda d: d["snap_share.1+2"] >= 0.85),
    ("RC: 1/2 z pauzą 1/1 co frazę (run_1/2.max_notes ≤ 33)", lambda d: d["run_1/2.max_notes"].fillna(0) <= 33),
    ("run_1/2.max_notes ≤ 17 (≤ 2 takty 1/2)", lambda d: d["run_1/2.max_notes"].fillna(0) <= 17),
    ("maks. 2 holdy naraz", lambda d: d["max_simultaneous_holds"].fillna(0) <= 2),
    ("maks. 1 hold naraz", lambda d: d["max_simultaneous_holds"].fillna(0) <= 1),
    ("RC: HP i OD ≤ 7,5", lambda d: (d["od"] <= 7.5) & (d["hp"] <= 7.5) if "od" in d else pd.Series(np.nan, index=d.index)),
    ("min. odstęp chwil ≥ 100 ms (gap_ms.min)", lambda d: d["gap_ms.min"] >= 100),
    ("p5 odstępu chwil ≥ 150 ms", lambda d: d["gap_ms.p5"] >= 150),
    ("downbeaty niesione ≥ 0,8", lambda d: d["downbeats_carried"] >= 0.8),
    ("chwile bez dźwięku ≤ 10%", lambda d: d["alignment.no_sound_share"] <= 0.10),
    ("lewa ręka 0,4–0,6", lambda d: d["left_hand_share"].between(0.4, 0.6)),
    ("hold_share ≥ 0,05", lambda d: d["hold_share"] >= 0.05),
    ("są przerwy ≥ 4 beaty (rests_ge_4b.per_min > 0)", lambda d: d["rests_ge_4b.per_min"] > 0),
    ("brak triol (triplet_share ≤ 0,01)", lambda d: d["triplet_share"] <= 0.01),
    ("kiai gęstsze niż reszta (kiai_density_ratio > 1)", lambda d: d["kiai_density_ratio"] > 1),
    # v2
    ("pokrycie beatów ≥ 0,8 (coverage.beat)", lambda d: d["coverage.beat"] >= 0.8),
    ("pokrycie półbeatów ≥ 0,35 (coverage.half)", lambda d: d["coverage.half"] >= 0.35),
    ("pokrycie 1/4 ≤ 0,10 (coverage.quarter)", lambda d: d["coverage.quarter"] <= 0.10),
    ("anchor RC ≤ 2 (anchor_rc_max_notes)", lambda d: d["anchor_rc_max_notes"].fillna(0) <= 2),
    ("tryl maks. ≤ 9 nut (trills.max_notes)", lambda d: d["trills.max_notes"].fillna(0) <= 9),
    ("brak shieldów 1/4 (holds_context.shield_1_4_per_min = 0)", lambda d: d["holds_context.shield_1_4_per_min"].fillna(0) == 0),
    ("puszczenie na następnej chwili ≥ 0,75 holdów", nn("holds_context.release_at_next_moment_share", lambda x: x >= 0.75)),
    ("holdy ≥ 1½ beatu z nutą w środku ≤ 0,5", nn("holds_context.notes_inside_share_by_length.2+", lambda x: x <= 0.5)),
    ("holdy < ¾ beatu bez nut w środku (≤ 0,1)", nn("holds_context.notes_inside_share_by_length.1/2", lambda x: x <= 0.1)),
    ("nuta na początku kiai ≥ 0,8", nn("kiai_start.note_share", lambda x: x >= 0.8)),
    ("akord na początku kiai ≥ 0,5", nn("kiai_start.chord_share", lambda x: x >= 0.5)),
    ("holdy 1 beat (¾–1½) z nutą w środku ≤ 0,2", nn("holds_context.notes_inside_share_by_length.1", lambda x: x <= 0.2)),
    ("głowa holda w akordzie ≥ 0,2", nn("holds_context.head_in_chord_share", lambda x: x >= 0.2)),
    ("nuta na ≥ 80% granic sekcji (±25 ms)", lambda d: d["sections.boundary_note_share"] >= 0.8),
    ("akord na ≥ 50% granic sekcji (±25 ms)", lambda d: d["sections.boundary_chord_share"] >= 0.5),
    ("rytm powtórzenia ≥ 0,8", nn("repetition.repeat.rhythm", lambda x: x >= 0.8)),
    ("tryle w jednej ręce ≤ 0,3", nn("trills.one_hand_share", lambda x: x <= 0.3)),
    ("ręka 4 takty: |lewa − 0,5| p90 ≤ 0,2", lambda d: d["hand_balance_4bar.p90"] <= 0.2),
]


def share(df, f):
    s = f(df)
    s = s[df.index]
    ok = s.dropna()
    return int(ok.sum()), int(len(ok))


rrows = []
for name, f in RULES:
    a_tr = share(TR, f)
    a_te = share(TE, f)
    a_al = share(A, f) if not name.startswith("RC: HP") else (None, None)
    frac = a_tr[0] / a_tr[1] if a_tr[1] else np.nan
    cls = "twarda zasada" if frac >= 0.95 else "silna tendencja" if frac >= 0.75 else "częsta (styl/zależna)" if frac >= 0.4 else "rzadka"
    # mapperzy łamiący regułę (trening)
    bad = TR[~f(TR).fillna(True).astype(bool)]
    rrows.append([name, f"{a_tr[0]}/{a_tr[1]}", f"{a_te[0]}/{a_te[1]}", "—" if a_al[0] is None else f"{a_al[0]}/{a_al[1]}", cls,
                  f"{bad['owner'].nunique()}"])
(RESULTS / "rules.md").write_text(md_table(rrows, ["reguła (na mapę)", "ludzie trening", "ludzie test", "algorytm test", "klasa (trening)",
                                                   "mapperzy łamiący (tr)"]))

# --- BPM -------------------------------------------------------------------------------------------------------
bp = TR.copy()
bp["mbpm"] = bp["song.main_bpm"]
bins = [0, 150, 180, 210, 400]
labels = ["<150", "150–180", "180–210", "≥210"]
bp["bbin"] = pd.cut(bp["mbpm"], bins, labels=labels, right=False)
BPM_METRICS = ["nps", "notes_per_beat", "moments_per_beat", "gap_ms.p50", "gap_ms.p5", "gap_ms.min", "gap_share.1/2", "gap_share.1",
               "gap_share.1/4", "snap_share.2", "snap_share.4", "run_1/2.max_notes", "run_1/4.max_notes", "run_1/4.count_per_min",
               "fast_runs_1_4_or_finer.count_per_min", "chord_share", "hold_share", "hold_len_beats.p50", "rests_ge_2b.per_min", "stars"]
brows = []
for m in BPM_METRICS:
    x = pd.to_numeric(bp[m], errors="coerce")
    rho, p = stats.spearmanr(bp["mbpm"], x, nan_policy="omit")
    cells = []
    for b in labels:
        sub = x[bp.bbin == b]
        a, c, e = q(sub)
        cells.append(f"{fmt(a)} / {fmt(c)} / {fmt(e)} (n={sub.notna().sum()})")
    brows.append([m, f"{rho:+.2f} (p={p:.3f})"] + cells)
txt = "### Zależność od BPM (trening, BPM = `song.main_bpm`)\n\n" + md_table(brows, ["metryka", "Spearman ρ z BPM"] + labels)

# regresja liniowa nps ~ bpm i notes_per_beat ~ bpm
import statsmodels.api as sm
for m in ["nps", "notes_per_beat", "gap_ms.p50"]:
    d = bp[["mbpm", m]].dropna()
    fit = sm.OLS(d[m], sm.add_constant(d["mbpm"])).fit()
    txt += f"\n\nOLS {m} = {fit.params['const']:.3f} + {fit.params['mbpm']:.5f}·BPM, R²={fit.rsquared:.2f}, p(BPM)={fit.pvalues['mbpm']:.3g}, n={len(d)}"
    # predykcje dla 120 / 180 / 240
    pr = fit.params['const'] + fit.params['mbpm'] * np.array([120, 180, 240])
    txt += f"; przewidywane przy 120/180/240 BPM: {', '.join(fmt(v) for v in pr)}"
# test na zbiorze testowym: ten sam znak korelacji?
te = TE.copy()
te["mbpm"] = te["song.main_bpm"]
txt += "\n\n### Sprawdzenie na teście (Spearman ρ z BPM)\n\n"
trows = []
for m in BPM_METRICS:
    rho, p = stats.spearmanr(te["mbpm"], pd.to_numeric(te[m], errors="coerce"), nan_policy="omit")
    rho_tr, _ = stats.spearmanr(bp["mbpm"], pd.to_numeric(bp[m], errors="coerce"), nan_policy="omit")
    ra, pa = stats.spearmanr(A["song.main_bpm"] if "song.main_bpm" in A else te["mbpm"], pd.to_numeric(A[m], errors="coerce"), nan_policy="omit") if m in A else (np.nan, np.nan)
    trows.append([m, f"{rho_tr:+.2f}", f"{rho:+.2f} (p={p:.2f})", f"{ra:+.2f} (p={pa:.2f})"])
txt += md_table(trows, ["metryka", "ρ trening", "ρ ludzie test", "ρ algorytm test"])
(RESULTS / "bpm.md").write_text(txt)

print((RESULTS / "rules.md").read_text())
print(txt)
