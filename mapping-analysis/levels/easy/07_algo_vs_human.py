"""Generator v19 Easy vs the human Easy maps of the 20 test songs: key metrics (p10/p50/p90), paired sign counts,
per genre, and per beat-tracking mode of the generator (same tempo / half tempo / no grid). Writes out/algo_vs_human*.csv."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from common import MAIN_GENRES, OUT, metrics, q, qstr, song

h = metrics("human")
a = metrics("algo")
for df, who in ((h, "human"), (a, "algo")):
    for g in ["1/2", "2", "1"]:
        df[f"gap_share.{g}"] = df[f"gap_share.{g}"].fillna(0)
    r = pd.read_csv(OUT / f"half_beat_rates_{who}.csv")
    df[["half_mapped", "beat_mapped"]] = df[["set_id"]].merge(r, on="set_id", how="left")[["half_mapped", "beat_mapped"]].values
    df["inner_share"] = df["lane_share.1"] + df["lane_share.2"]
    df["timing_off_share"] = df["snap_share.12"] + df["snap_share.16"] + df["snap_share.off"]
    df["rep_rhythm_gain"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]


def mode(sid):
    bt = song(sid)["algo_beat_tracking"]
    if not bt.get("snapped"):
        return "bez siatki"
    r = bt.get("human_beat_over_algo_beat", 1)
    if r < 0.75:
        return "połowa tempa"
    return "zgodne tempo" + (" (podwojone)" if bt.get("fold_factor", 1) > 1 else "")


a["mode"] = a.set_id.map(mode)
a["db_agree"] = a.set_id.map(lambda s: song(s)["algo_beat_tracking"].get("downbeat_on_human_downbeat_share", np.nan))
te = h[h.split == "test"].copy()

KEY = [
    ("nps", "nuty/s"), ("notes_per_beat", "nuty/beat"), ("nps_window.p90", "nuty/s okno 2 s p90"), ("beat_mapped", "beaty z nutą"),
    ("half_mapped", "półbeaty z nutą"), ("downbeats_carried", "downbeaty z nutą"), ("on_beat_share", "chwile na beacie"),
    ("gap_share.1", "odstępy 1/1"), ("gap_share.1/2", "odstępy 1/2"), ("gap_share.2", "odstępy 2 beaty"), ("run_1/2.max_notes", "najdł. seria 1/2"),
    ("gap_ms.min", "min. odstęp ms"), ("timing_off_share", "chwile poza siatką 1/8, 1/6"), ("grid_error_ms.p50", "błąd siatki ms p50"),
    ("chord_share", "akordy"), ("chord2_split_hands_share", "akordy w dwóch rękach"), ("chord_position_share.downbeat", "akordy na downbeacie"),
    ("hold_share", "holdy"), ("hold_len_beats.p50", "dł. holda (beaty) p50"), ("holds_with_notes_inside_share", "holdy z nutą w środku"),
    ("other_hand_notes_per_beat_in_hold.p50", "nuty drugiej ręki na beat holda p50"), ("release_snap_share.1", "puszczenia na beacie"),
    ("inner_share", "tory 1+2 (środek)"), ("trill_share", "tryle"), ("single_step_share.0", "ten sam tor (pojedyncze)"),
    ("minijack_share", "minijacki"), ("pattern4_entropy_bits", "entropia wzorców 4"),
    ("rests_ge_2b.per_min", "pauzy ≥2 beaty /min"), ("rests_ge_2b.time_share", "pauzy ≥2 beaty, udział czasu"), ("rests_ge_8b.per_min", "pauzy ≥8 beatów /min"),
    ("longest_rest_beats", "najdł. pauza (beaty)"), ("bar_notes_cv", "CV nut na takt"), ("phrase4_notes_p90_over_p10", "kontrast 4 taktów p90/p10"),
    ("kiai_density_ratio", "gęstość kiai / poza"), ("sections.bar_density_vs_rms_spearman", "korelacja nuty/takt z RMS"),
    ("sections.boundary_note_share", "granice z nutą"), ("sections.boundary_chord_share", "granice z akordem"),
    ("sections.boundary_falling_density_ratio_median", "gęstość po/przed, granice w dół"),
    ("repetition.repeat.rhythm", "rytm w powtórzeniach"), ("rep_rhythm_gain", "rytm: powtórzenie − baza"), ("repetition.repeat.lanes", "tory w powtórzeniach"),
    ("alignment.no_sound_share", "chwile bez dźwięku"), ("alignment.stem_vocals.share", "chwile na onsecie wokalu"),
    ("alignment.stem_drums.share", "chwile na onsecie perkusji (stem)"), ("plugin_events.snare.recall_strong", "recall silnych werbli"),
    ("plugin_events.kick.recall_strong", "recall silnych stóp"), ("plugin_events.lead.recall", "recall leadu"), ("first_ms", "pierwsza nuta (ms)"),
]
rows = []
for c, lab in KEY:
    pair = te[["set_id", c]].merge(a[["set_id", c]], on="set_id", suffixes=("_h", "_a")).dropna()
    try:
        p = wilcoxon(pair[c + "_h"], pair[c + "_a"]).pvalue
    except ValueError:
        p = np.nan
    rows.append({"metryka": lab, "klucz": c, "ludzie p10/p50/p90": qstr(te[c]), "algorytm p10/p50/p90": qstr(a[c]), "par": len(pair),
                 "algo>ludzie": f"{int((pair[c + '_a'] > pair[c + '_h']).sum())}/{len(pair)}", "Wilcoxon p": p})
res = pd.DataFrame(rows)
pd.set_option("display.width", 250)
pd.set_option("display.max_rows", 200)
print(res.to_string(index=False, float_format=lambda v: f"{v:.2g}"))
res.to_csv(OUT / "algo_vs_human.csv", index=False)

print("\n== per genre: p50 humans / p50 generator")
G = [("nps", 2), ("notes_per_beat", 2), ("half_mapped", 2), ("gap_share.1/2", 2), ("downbeats_carried", 2), ("chord_share", 2), ("hold_share", 2),
     ("holds_with_notes_inside_share", 2), ("trill_share", 2), ("rests_ge_2b.per_min", 1), ("kiai_density_ratio", 2), ("sections.boundary_note_share", 2),
     ("repetition.repeat.rhythm", 2), ("alignment.stem_vocals.share", 2), ("timing_off_share", 2)]
rows = []
for g in MAIN_GENRES + ["novelty"]:
    th, ta = te[te.genre == g], a[a.genre == g]
    r = {"gatunek": g, "n": len(th)}
    for c, nd in G:
        r[c] = f"{q(th[c])[1]:.{nd}f} / {q(ta[c])[1]:.{nd}f}"
    rows.append(r)
pg = pd.DataFrame(rows)
print(pg.T.to_string())
pg.to_csv(OUT / "algo_vs_human_genre.csv", index=False)

print("\n== per song")
cols = ["nps", "notes_per_beat", "half_mapped", "gap_share.1/2", "downbeats_carried", "hold_share", "holds_with_notes_inside_share", "rests_ge_2b.per_min", "timing_off_share", "sections.boundary_note_share"]
m = te[["set_id", "genre", "song.main_bpm", "artist", "title"] + cols].merge(a[["set_id", "mode", "db_agree"] + cols], on="set_id", suffixes=("_h", "_a"))
show = ["set_id", "genre", "song.main_bpm", "mode", "db_agree"] + [f"{c}_{s}" for c in cols for s in ("h", "a")]
print(m[show].to_string(index=False, float_format=lambda v: f"{v:.2f}"))
m.to_csv(OUT / "algo_vs_human_songs.csv", index=False)

print("\n== by tracking mode: p50 human / generator")
for md, d in m.groupby("mode"):
    print(f"  {md} (n={len(d)}): " + ", ".join(f"{c} {d[c + '_h'].median():.2f}/{d[c + '_a'].median():.2f}" for c in ["nps", "notes_per_beat", "half_mapped", "gap_share.1/2", "downbeats_carried", "rests_ge_2b.per_min"]))
