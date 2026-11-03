"""Gatunki na Normal (ludzie): które reguły są wspólne, które zależą od gatunku.

Tylko anime, electronic, video game, pop mają dość utworów; reszta = „za mała grupa”.
Trening: mediana i p10/p90 na gatunek, Kruskal–Wallis (4 gatunki) z korektą Benjaminiego–Hochberga,
dodatkowo OLS metryka ~ gatunek + BPM (czy różnica nie wynika tylko z tempa). Test: mediany gatunków (n = 4–6) i zgodność kierunku.

Wynik: results/genres.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.stats.multitest import multipletests

from common import MAIN_GENRES, RESULTS, algo, fmt, fmt_q, human, md_table

H = human()
A = algo()
for df in (H, A):
    df["chord3"] = df["chord_size_share.3"].fillna(0) + df["chord_size_share.4"].fillna(0)
    df["rep_rhythm_gain"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]
    df["mbpm"] = df["song.main_bpm"]

M = ["mbpm", "stars", "nps", "notes_per_beat", "moments_per_beat", "gap_share.1", "gap_share.1/2", "gap_share.1/4", "snap_share.4", "triplet_share",
     "run_1/2.max_notes", "run_1/4.max_notes", "chord_share", "chord_position_share.offbeat", "hold_share", "hold_len_beats.p50",
     "holds_with_notes_inside_share", "rests_ge_2b.per_min", "longest_rest_beats", "bar_notes_cv", "phrase4_notes_p90_over_p10", "kiai_density_ratio",
     "trill_share", "stair_share", "pattern4_entropy_bits", "minijack_share", "jack_max_notes",
     "alignment.perc.share", "alignment.harm.share", "alignment.stem_vocals.share", "alignment.stem_drums.share", "alignment.stem_bass.share",
     "plugin_events.lead.recall", "plugin_events.snare.recall", "plugin_events.kick.recall", "plugin_events.bass.recall",
     "repetition.repeat.rhythm", "rep_rhythm_gain", "repetition.repeat.lanes_or_mirror",
     "sections.boundary_chord_share", "sections.bar_density_vs_rms_spearman"]

TR = H[(H.split == "train") & H.genre.isin(MAIN_GENRES)]
TE = H[(H.split == "test") & H.genre.isin(MAIN_GENRES)]
small = H[~H.genre.isin(MAIN_GENRES)]

rows, pv, pv_adj = [], [], []
for m in M:
    groups = [pd.to_numeric(TR[TR.genre == g][m], errors="coerce").dropna() for g in MAIN_GENRES]
    try:
        p = stats.kruskal(*groups).pvalue
    except ValueError:
        p = np.nan
    # OLS z BPM
    d = TR[["genre", "mbpm", m]].rename(columns={m: "y"}).dropna()
    try:
        fit = smf.ols("y ~ C(genre) + mbpm", data=d).fit() if m != "mbpm" else smf.ols("y ~ C(genre)", data=d).fit()
        anova_p = fit.f_pvalue if m == "mbpm" else fit.compare_f_test(smf.ols("y ~ mbpm", data=d).fit())[1]
    except Exception:
        anova_p = np.nan
    pv.append(p)
    pv_adj.append(anova_p)
    rows.append([m] + [f"{fmt(g.median())} ({fmt(g.quantile(.1))}–{fmt(g.quantile(.9))})" for g in groups])
ok = ~np.isnan(pv)
q = np.full(len(pv), np.nan)
q[ok] = multipletests(np.array(pv)[ok], method="fdr_bh")[1]
ok2 = ~np.isnan(pv_adj)
q2 = np.full(len(pv_adj), np.nan)
q2[ok2] = multipletests(np.array(pv_adj)[ok2], method="fdr_bh")[1]

# test: mediany i zgodność kierunku (czy gatunek z najwyższą medianą w treningu jest powyżej mediany testu ogółem)
trows = []
for i, m in enumerate(M):
    tr_med = {g: pd.to_numeric(TR[TR.genre == g][m], errors="coerce").median() for g in MAIN_GENRES}
    te_med = {g: pd.to_numeric(TE[TE.genre == g][m], errors="coerce").median() for g in MAIN_GENRES}
    order_tr = sorted(MAIN_GENRES, key=lambda g: tr_med[g])
    rho = stats.spearmanr([tr_med[g] for g in MAIN_GENRES], [te_med[g] for g in MAIN_GENRES]).statistic
    rows[i] += [f"{pv[i]:.3f}", f"{q[i]:.3f}", f"{q2[i]:.3f}"]
    trows.append([m] + [fmt(te_med[g]) for g in MAIN_GENRES] + [f"{rho:+.2f}"])

hdr = ["metryka"] + [f"{g} (tr n={int((TR.genre == g).sum())}, {TR[TR.genre == g].owner.nunique()} mapp.)" for g in MAIN_GENRES] + \
      ["KW p", "KW q (BH)", "q: gatunek ponad BPM (OLS F)"]
out = ["### Ludzie trening: mediana (p10–p90) na gatunek\n\n" + md_table(rows, hdr)]
out.append("### Ludzie test: mediany gatunków (n=" + ", ".join(f"{g} {int((TE.genre == g).sum())}" for g in MAIN_GENRES) +
           ") i Spearman ρ kolejności gatunków trening–test (4 punkty, tylko orientacyjnie)\n\n" +
           md_table(trows, ["metryka"] + MAIN_GENRES + ["ρ kolejności"]))

# grupy za małe
srows = []
for g, sub in small.groupby("genre"):
    srows.append([g, len(sub), ", ".join(sorted(sub.split.unique())), fmt(sub.nps.median()), fmt(sub.notes_per_beat.median()), fmt(sub["gap_share.1/2"].median()),
                  fmt(sub.chord_share.median()), fmt(sub.hold_share.median())])
out.append("### Gatunki za małe do uogólnień (tylko informacyjnie)\n\n" + md_table(srows, ["gatunek", "map", "split", "nps", "nuty/beat", "gap 1/2", "akordy", "holdy"]))

# algorytm vs ludzie na teście, wg gatunku
KEY = ["nps", "notes_per_beat", "gap_share.1/2", "gap_share.1", "run_1/2.max_notes", "chord_share", "chord_position_share.offbeat",
       "hold_len_beats.p50", "holds_with_notes_inside_share", "release_snap_share.1", "downbeats_carried", "snap_share.off", "trill_share",
       "repetition.repeat.rhythm", "rests_ge_2b.per_min", "kiai_density_ratio", "plugin_events.snare.recall", "plugin_events.lead.recall",
       "alignment.no_sound_share", "sections.boundary_chord_share"]
HT = H[H.split == "test"].set_index("set_id")
AT = A.set_index("set_id")
grows = []
for m in KEY:
    cells = [m]
    for g in MAIN_GENRES + ["novelty"]:
        ids = AT[AT.genre == g].index
        hv = pd.to_numeric(HT.loc[ids, m], errors="coerce")
        av = pd.to_numeric(AT.loc[ids, m], errors="coerce")
        cells.append(f"{fmt(hv.median())} → {fmt(av.median())}")
    grows.append(cells)
hdr = ["metryka (ludzie p50 → algorytm p50)"] + [f"{g} (n={int((AT.genre == g).sum())})" for g in MAIN_GENRES + ["novelty"]]
out.append("### Test: ludzie vs algorytm wg gatunku (mediany; n bardzo małe)\n\n" + md_table(grows, hdr))
(RESULTS / "genres.md").write_text("\n\n".join(out))
print("\n\n".join(out))
