"""Which Easy rules hold across genres and which depend on the genre (anime, electronic, video game, pop; the rest too small).
Kruskal-Wallis on the train maps; the test maps checked for the same direction. BPM is a confounder: a partial check
regresses each metric on log BPM first and tests the residuals."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import kruskal

from common import MAIN_GENRES, OUT, metrics, q

h = metrics("human")
for g in ["1/2", "2", "3/4"]:
    h[f"gap_share.{g}"] = h[f"gap_share.{g}"].fillna(0)
h["rep_rhythm_gain"] = h["repetition.repeat.rhythm"] - h["repetition.baseline.rhythm"]
h["beat_mapped"] = h["coverage.beat"]  # metrics v2
h["half_mapped"] = h["coverage.half"]
cols = ["nps", "notes_per_beat", "beat_mapped", "half_mapped", "gap_share.1/2", "gap_share.2", "run_1/2.max_notes", "chord_share",
        "chord2_split_hands_share", "chord_rate_on_mapped_beats", "hold_share", "holds_context.release_at_next_moment_share", "hold_len_beats.p50", "holds_with_notes_inside_share", "max_simultaneous_holds",
        "trill_share", "trills.runs_per_min", "hand_balance_4bar.p50", "stair_share", "pattern4_entropy_bits", "minijack_share", "jack_max_notes", "rests_ge_2b.per_min", "longest_rest_beats",
        "bar_notes_cv", "phrase4_notes_p90_over_p10", "kiai_density_ratio", "sections.bar_density_vs_rms_spearman",
        "sections.boundary_note_share", "sections.boundary_chord_share", "kiai_start.chord_share", "sections.boundary_empty_last_beat_share", "rep_rhythm_gain", "on_beat_share", "downbeats_carried",
        "alignment.stem_vocals.share", "alignment.stem_drums.share", "alignment.harm.share", "plugin_events.lead.recall", "plugin_events.kick.recall",
        "plugin_events.snare.recall", "song.main_bpm", "stars"]
tr = h[h.split == "train"]
te = h[h.split == "test"]
rows = []
for c in cols:
    groups = [tr.loc[tr.genre == g, c].dropna() for g in MAIN_GENRES]
    try:
        p = kruskal(*groups).pvalue
    except ValueError:
        p = np.nan
    # partial: residual after log BPM
    d = tr[tr.genre.isin(MAIN_GENRES)][[c, "song.main_bpm", "genre"]].dropna()
    if c != "song.main_bpm" and len(d) > 10:
        res = sm.OLS(d[c], sm.add_constant(np.log(d["song.main_bpm"]))).fit().resid
        pr = kruskal(*[res[d.genre == g] for g in MAIN_GENRES]).pvalue
    else:
        pr = np.nan
    r = {"metric": c, "KW p": p, "KW p | BPM": pr}
    for g in MAIN_GENRES:
        s = tr.loc[tr.genre == g, c]
        p10, p50, p90 = q(s)
        r[g] = f"{p50:.2f} ({p10:.2f}-{p90:.2f})"
        r[g + " test"] = f"{q(te.loc[te.genre == g, c])[1]:.2f}"
    others = tr.loc[~tr.genre.isin(MAIN_GENRES), c]
    r["inne (n=%d)" % len(others)] = f"{q(others)[1]:.2f}"
    rows.append(r)
res = pd.DataFrame(rows)
pd.set_option("display.width", 320)
pd.set_option("display.max_columns", 30)
pd.set_option("display.max_colwidth", 22)
print("n train per genre:", {g: (int((tr.genre == g).sum()), tr.loc[tr.genre == g, "owner"].nunique()) for g in MAIN_GENRES},
      "test:", {g: int((te.genre == g).sum()) for g in MAIN_GENRES}, "others train:", tr.loc[~tr.genre.isin(MAIN_GENRES), "genre"].value_counts().to_dict())
print(res.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
res.to_csv(OUT / "genres.csv", index=False)
