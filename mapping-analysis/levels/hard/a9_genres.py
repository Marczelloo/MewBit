"""Gatunki na Hard: kwantyle (trening), test kierunku na zbiorze testowym, efekt gatunku po uwzględnieniu BPM.
Tylko anime, electronic, video game, pop mają dość map; reszta = 'other' (za mała grupa).
Wynik: tables/genre_profile.csv, tables/genre_effects.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats

from common import BIG_GENRES, TABLES, human

h = human()
pat = pd.read_csv(f"{TABLES}/patterns_per_chart.csv")
hol = pd.read_csv(f"{TABLES}/holds_per_chart.csv")
sl = pd.read_csv(f"{TABLES}/slot_rates_per_song.csv")
pat = pat[pat.who == "human"][["set_id", "hand_dev4bar_p50", "chord_share_in_q_streams", "chord2_jedna ręka L", "chord2_jedna ręka P", "trill_max_notes"]]
hol = hol[hol.who == "human"][["set_id", "release_on_1_4", "with_inside"]]
sl = sl[sl.who == "human"][["set_id", "rate_1/1", "rate_1/2", "rate_1/4", "rate_1/8", "chord_rate_1/1", "rate_1/4_with_perc_onset"]]
h = h.merge(pat, on="set_id", how="left").merge(hol, on="set_id", how="left").merge(sl, on="set_id", how="left")
h["one_hand_jump"] = h["chord2_jedna ręka L"] + h["chord2_jedna ręka P"]
METRICS = ["bpm", "nps", "notes_per_beat", "moments_per_beat", "chord_share", "chord_size_share.3", "one_hand_jump", "hold_share",
           "hold_len_beats.p50", "gap_share.1/2", "gap_share.1/4", "triplet_share", "snap_share.4", "run_1/2.max_notes", "run_1/4.max_notes",
           "trill_share", "stair_share", "minijack_share", "jack_max_notes", "pattern4_distinct_per_100", "rests_ge_2b.per_min",
           "empty_bar_share", "bar_notes_cv", "phrase4_notes_p90_over_p10", "kiai_density_ratio", "alignment.perc.share",
           "alignment.no_sound_share", "plugin_events.lead.recall", "plugin_events.bass.recall", "plugin_events.kick.recall",
           "plugin_events.snare.recall", "plugin_events.hat.recall", "repetition.repeat.rhythm", "sections.boundary_chord_share",
           "rate_1/1", "rate_1/2", "rate_1/4", "chord_rate_1/1", "rate_1/4_with_perc_onset", "release_on_1_4", "with_inside",
           "hand_dev4bar_p50", "chord_share_in_q_streams", "trill_max_notes", "left_hand_share", "single_step_share.1"]
rows = []
for split in ["train", "test"]:
    d0 = h[h.split == split]
    for g in BIG_GENRES + ["other"]:
        d = d0[d0.genre4 == g]
        for m in METRICS:
            s = d[m].dropna()
            rows.append(dict(split=split, genre=g, n=len(d), mappers=d.owner.nunique(), metric=m, n_metric=len(s),
                             p10=s.quantile(0.1), p50=s.median(), p90=s.quantile(0.9)))
prof = pd.DataFrame(rows)
prof.to_csv(f"{TABLES}/genre_profile.csv", index=False)

eff = []
tr = h[(h.split == "train") & h.genre4.isin(BIG_GENRES)].copy()
te = h[(h.split == "test") & h.genre4.isin(BIG_GENRES)].copy()
for m in METRICS:
    if m == "bpm":
        continue
    d = tr[[m, "bpm", "genre4"]].dropna().rename(columns={m: "y"})
    if d.y.nunique() < 4:
        continue
    f0 = smf.ols("y ~ np.log2(bpm/180)", d).fit()
    f1 = smf.ols("y ~ np.log2(bpm/180) + C(genre4)", d).fit()
    lr = f1.compare_f_test(f0)
    kw = stats.kruskal(*[g.y.values for _, g in d.groupby("genre4")])
    # residual medians by genre (BPM removed), train and test
    d["res"] = d.y - f0.predict(d)
    dt = te[[m, "bpm", "genre4"]].dropna().rename(columns={m: "y"})
    dt["res"] = dt.y - f0.predict(dt) if len(dt) else np.nan
    row = dict(metric=m, n=len(d), F_p_genre_given_bpm=lr[1], kruskal_p=kw.pvalue)
    for g in BIG_GENRES:
        row[f"res_train_{g}"] = d[d.genre4 == g].res.median()
        row[f"res_test_{g}"] = dt[dt.genre4 == g].res.median() if (dt.genre4 == g).any() else np.nan
    # does the test order agree with the train order (sign of residual medians)?
    tr_s = np.sign([row[f"res_train_{g}"] for g in BIG_GENRES])
    te_s = np.sign([row[f"res_test_{g}"] for g in BIG_GENRES])
    row["test_sign_agree"] = int(np.sum(tr_s == te_s))
    eff.append(row)
E = pd.DataFrame(eff).sort_values("F_p_genre_given_bpm")
E.to_csv(f"{TABLES}/genre_effects.csv", index=False)
pd.set_option("display.width", 260)
print(E.round(3).head(30).to_string())
print(prof[(prof.split == "train")].groupby("genre")[["n", "mappers"]].first())
print(prof[(prof.split == "test")].groupby("genre")[["n", "mappers"]].first())
