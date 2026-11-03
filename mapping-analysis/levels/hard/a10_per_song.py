"""Tabela na utwór testowy: śledzenie beatu algorytmu i kluczowe różnice algorytm - człowiek (Hard).
Wynik: tables/per_song_test.csv
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from scipy import stats

from common import ALGO_RAW, FLAGGED, TABLES, algo, human, song

h = human().set_index("set_id")
a = algo().set_index("set_id")
rob = pd.read_csv(f"{TABLES}/robust_rhythm.csv").set_index(["set_id", "who"])
pat = pd.read_csv(f"{TABLES}/patterns_per_chart.csv").set_index(["set_id", "who"])
hol = pd.read_csv(f"{TABLES}/holds_per_chart.csv").set_index(["set_id", "who"])
sl = pd.read_csv(f"{TABLES}/slot_rates_per_song.csv").set_index(["set_id", "who"])
rows = []
for sid in a.index:
    s = song(sid)
    b = s.get("algo_beat_tracking", {})
    raw = json.load(open(os.path.join(ALGO_RAW, f"{sid}.json")))
    leaders = s.get("algo_leaders", [])
    r = dict(set_id=sid, artist=h.loc[sid, "artist"], title=h.loc[sid, "title"], genre=h.loc[sid, "genre4"], bpm=h.loc[sid, "bpm"],
             flagged=sid in FLAGGED, variable_bpm=s.get("variable_bpm"), meters=str(s.get("meters")),
             algo_bpm=s.get("algo_tempo", {}).get("bpm"), algo_conf=s.get("algo_tempo", {}).get("confidence"),
             snapped=b.get("snapped", False), beat_ratio=b.get("human_beat_over_algo_beat"), fold=b.get("fold_factor"),
             on_beat=b.get("on_human_beat_share"), half_phase=b.get("on_human_half_not_beat_share"),
             downbeat_agree=b.get("downbeat_on_human_downbeat_share"), vocal=s.get("algo_vocal"),
             lead_share=np.mean([l == "lead" for l in leaders]) if leaders else np.nan,
             drums_share=np.mean([l == "drums" for l in leaders]) if leaders else np.nan,
             bands_share=np.mean([l == "bands" for l in leaders]) if leaders else np.nan,
             algo_stars_game=raw["chart"]["stars"], human_sr=h.loc[sid, "stars"])
    for m in ["nps", "moments_per_beat", "chord_share", "downbeats_carried", "snap_share.8", "snap_share.16", "snap_share.off",
              "trill_share", "left_hand_share", "hold_len_beats.p50", "holds_with_notes_inside_share", "sections.boundary_chord_share",
              "alignment.perc.share", "alignment.no_sound_share", "plugin_events.lead.recall", "plugin_events.kick.recall", "grid_error_ms.p50"]:
        r[f"H {m}"] = h.loc[sid, m]
        r[f"A {m}"] = a.loc[sid, m]
    for m in ["gap_other", "gap_3/4", "run_le_1/2_max", "run_1/2_max"]:
        r[f"H q:{m}"] = rob.loc[(sid, "human"), m]
        r[f"A q:{m}"] = rob.loc[(sid, "algo"), m]
    for m in ["hand_dev4bar_p50", "chord_share_in_q_streams"]:
        r[f"H {m}"] = pat.loc[(sid, "human"), m]
        r[f"A {m}"] = pat.loc[(sid, "algo"), m]
    for m in ["rate_1/1", "rate_1/2", "rate_1/4", "rate_1/8", "chord_rate_1/1"]:
        r[f"H {m}"] = sl.loc[(sid, "human"), m]
        r[f"A {m}"] = sl.loc[(sid, "algo"), m]
    r["A release_on_1_4"] = hol.loc[(sid, "algo"), "release_on_1_4"]
    rows.append(r)
T = pd.DataFrame(rows)
T.to_csv(f"{TABLES}/per_song_test.csv", index=False)
pd.set_option("display.width", 300); pd.set_option("display.max_columns", 80)
cols = ["set_id", "genre", "bpm", "algo_bpm", "snapped", "beat_ratio", "fold", "on_beat", "half_phase", "downbeat_agree", "drums_share", "lead_share",
        "H nps", "A nps", "H chord_share", "A chord_share", "A snap_share.16", "A snap_share.off", "A downbeats_carried", "A q:gap_other", "A q:run_le_1/2_max",
        "A rate_1/8", "A hand_dev4bar_p50", "A left_hand_share", "A release_on_1_4"]
print(T[cols].round(2).to_string())
# relations inside the test set (n=19 snapped)
S = T[T.snapped == True]
for x, y in [("downbeat_agree", "A downbeats_carried"), ("downbeat_agree", "A sections.boundary_chord_share"), ("half_phase", "A rate_1/1"),
             ("A grid_error_ms.p50", "A snap_share.16"), ("beat_ratio", "A rate_1/8"), ("beat_ratio", "A q:gap_other"), ("drums_share", "A trill_share"),
             ("lead_share", "A left_hand_share"), ("lead_share", "A plugin_events.lead.recall")]:
    rho, p = stats.spearmanr(S[x], S[y], nan_policy="omit")
    print(f"{x} ~ {y}: rho={rho:.2f} p={p:.3f} n={S[[x, y]].dropna().shape[0]}")
print(S.groupby(S.beat_ratio.round(1))[["A rate_1/8", "A q:gap_other", "A chord_share", "A nps", "A snap_share.16"]].median())
