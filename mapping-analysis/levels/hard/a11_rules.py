"""Reguły ludzkiego Hard: udział map spełniających regułę (trening -> test) i udział chartów algorytmu.
Klasy: twarda zasada >= 95% map treningowych, silna tendencja >= 80%, inaczej styl. Progi reguł ustawione na treningu.
Wynik: tables/rules.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, human

h = human()
a = algo()
a["owner"] = "algo"
a["split"] = "algo"
extra = {}
for name, key in [("patterns_per_chart", ["hand_dev4bar_p50", "hand_dev4bar_gt_0.2", "chord_share_in_q_streams", "trill_max_notes",
                                          "chord2_jedna ręka L", "chord2_jedna ręka P"]),
                  ("holds_per_chart", ["release_on_1_4", "holds", "with_inside", "len_p50"]),
                  ("slot_rates_per_song", ["rate_1/1", "rate_1/2", "rate_1/4", "rate_1/8", "chord_rate_1/1", "rate_downbeat"])]:
    t = pd.read_csv(f"{TABLES}/{name}.csv")
    extra[name] = t
rob = pd.read_csv(f"{TABLES}/robust_rhythm.csv")
ev = pd.read_csv(f"{TABLES}/sections_events.csv")
evs = ev.groupby(["who", "set_id"]).agg(note_on_boundary=("note_on_boundary", "mean"), chord_on_boundary=("chord_on_boundary", "mean")).reset_index()


def enrich(df, who):
    out = df.copy()
    for name, t in extra.items():
        t = t[t.who == who].drop(columns=[c for c in ["who", "split", "genre", "owner", "bpm", "grp", "notes", "hold_share"] if c in t.columns])
        out = out.merge(t, on="set_id", how="left")
    out = out.merge(evs[evs.who == who].drop(columns="who"), on="set_id", how="left")
    r = rob[rob.who == who].drop(columns=["who", "genre", "n", "split"])
    out = out.merge(r, on="set_id", how="left", suffixes=("", "_q"))
    rd = pd.read_csv(f"{TABLES}/robust_repetition_diff.csv")
    rd = rd[rd.who == who][["set_id", "rhythm_diff", "lanes_diff"]].rename(columns={"rhythm_diff": "rep_rhythm_diff", "lanes_diff": "rep_lanes_diff"})
    out = out.merge(rd, on="set_id", how="left")
    out["one_hand_jump"] = out["chord2_jedna ręka L"] + out["chord2_jedna ręka P"]
    return out


H = enrich(h, "human")
A = enrich(a, "algo")
RULES = [
    ("Gęstość: nps 7,5-11", lambda d: d["nps"].between(7.5, 11)),
    ("Beaty (1/1) zmapowane >= 80%", lambda d: d["rate_1/1"] >= 0.8),
    ("Downbeaty niesione >= 85%", lambda d: d["downbeats_carried"] >= 0.85),
    ("Półbeaty (1/2) zmapowane >= 60%", lambda d: d["rate_1/2"] >= 0.6),
    ("Sloty 1/8 prawie puste (<= 1%)", lambda d: d["rate_1/8"] <= 0.01),
    ("Brak chwil poza siatką (snap off = 0)", lambda d: d["snap_share.off"] == 0),
    ("Bez serii 1/8 dłuższych niż 3 nuty", lambda d: d["run_1/8.max_notes"] <= 3),
    ("Akordy >= 25% chwil", lambda d: d["chord_share"] >= 0.25),
    ("Akord na >= 50% zmapowanych beatów", lambda d: d["chord_rate_1/1"] >= 0.5),
    ("Skoki jednej ręki >= 25% akordów 2-nutowych", lambda d: d["one_hand_jump"] >= 0.25),
    ("Brak akordów 4-nutowych", lambda d: d["chord_size_share.4"] == 0),
    ("Akordy 3-nutowe obecne (> 0)", lambda d: d["chord_size_share.3"] > 0),
    ("Balans rąk: lewa 48-52%", lambda d: d["left_hand_share"].between(0.48, 0.52)),
    ("Balans rąk w 4 taktach: mediana odchylenia <= 3 pp", lambda d: d["hand_dev4bar_p50"] <= 0.03),
    ("Puszczenia holdów na siatce 1/4 >= 95% (>= 10 holdów)", lambda d: np.where(d["holds"] >= 10, d["release_on_1_4"] >= 0.95, np.nan)),
    ("Hold >= 1/4 beatu (p10)", lambda d: np.where(d["n_holds"] > 0, d["hold_len_beats.p10"] >= 0.24, np.nan)),
    ("Holdy z nutą w środku <= 40%", lambda d: np.where(d["n_holds"] > 0, d["holds_with_notes_inside_share"] <= 0.4, np.nan)),
    ("Mediana długości holda <= 1 beat", lambda d: np.where(d["n_holds"] > 0, d["hold_len_beats.p50"] <= 1.01, np.nan)),
    ("Holdy obecne (>= 2% nut)", lambda d: d["hold_share"] >= 0.02),
    ("Jack <= 7 chwil", lambda d: d["jack_max_notes"] <= 7),
    ("Brak minijacków 1/4 (<= 0,5% par)", lambda d: d["minijack_fast_share"] <= 0.005),
    ("Tryl <= 9 nut (miara pomocnicza)", lambda d: d["trill_max_notes"] <= 9),
    ("trill_share <= 0,12", lambda d: d["trill_share"] <= 0.12),
    ("Anchor < 5 nut (RC)", lambda d: d["anchor_max_notes"] < 5),
    ("Odstępy 'other' po kwantyzacji <= 2%", lambda d: d["gap_other"] <= 0.02),
    ("Odstępy 3/4 po kwantyzacji <= 3%", lambda d: d["gap_3/4"] <= 0.03),
    ("Najdłuższy ciąg odstępów <= 1/2 >= 40 chwil", lambda d: d["run_le_1/2_max"] >= 40),
    ("Rytm powtórzeń: różnica powtórzenie - baza >= 0,1 (pomocnicza)", lambda d: d["rep_rhythm_diff"] >= 0.1),
    ("Tory powtórzeń: różnica powtórzenie - baza >= 0,05 (pomocnicza)", lambda d: d["rep_lanes_diff"] >= 0.05),
    ("Bez przerw >= 4 beaty", lambda d: d["rests_ge_4b.per_min"] == 0),
    ("Puste takty <= 5%", lambda d: d["empty_bar_share"] <= 0.05),
    ("Kiai gęstsze niż reszta (ratio > 1)", lambda d: np.where(d["kiai_density_ratio"].notna(), d["kiai_density_ratio"] > 1.0, np.nan)),
    ("Nuta na downbeacie >= 75% granic sekcji", lambda d: d["note_on_boundary"] >= 0.75),
    ("Akord na downbeacie >= 50% granic sekcji", lambda d: d["chord_on_boundary"] >= 0.5),
    ("Bez dźwięku (no_sound) <= 20% chwil", lambda d: d["alignment.no_sound_share"] <= 0.2),
    ("OD <= 8 (RC)", lambda d: d["od"] <= 8),
]
rows = []
for name, f in RULES:
    row = dict(rule=name)
    for lab, d in [("train", H[H.split == "train"]), ("test", H[H.split == "test"]), ("algo", A)]:
        try:
            v = pd.Series(f(d), index=d.index).astype(float)
        except KeyError:
            row[f"{lab}_share"] = np.nan
            continue
        ok = v.notna()
        row[f"{lab}_n"] = int(ok.sum())
        row[f"{lab}_mappers"] = int(d.loc[ok, "owner"].nunique())
        row[f"{lab}_share"] = float(v[ok].mean()) if ok.any() else np.nan
    s = row.get("train_share", np.nan)
    row["klasa"] = "twarda zasada" if s >= 0.95 else ("silna tendencja" if s >= 0.8 else "styl / zależne")
    t = row.get("test_share", np.nan)
    row["test_ok"] = "tak" if (t >= s - 0.1) else "nie"
    rows.append(row)
R = pd.DataFrame(rows)
R.to_csv(f"{TABLES}/rules.csv", index=False)
pd.set_option("display.width", 250)
print(R[["rule", "train_n", "train_mappers", "train_share", "test_n", "test_share", "algo_n", "algo_share", "klasa", "test_ok"]].round(2).to_string())
