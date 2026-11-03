"""Kandydaci do odsłuchu i gry: okna 4 taktów (takty siatki ludzkiej) z utworów testowych, gdzie Hard algorytmu
najbardziej odbiega od ludzkiego. Czasy na osi zdekodowanego audio (jak nuty w danych).
Wynik: tables/candidate_windows.csv (wszystkie okna z miarami), wypis najlepszych okien na problem.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, human, mmss, notes, slots, song


def grid_dist(t, gt):
    i = np.clip(np.searchsorted(gt, t), 1, len(gt) - 1)
    return np.minimum(np.abs(gt[i] - t), np.abs(gt[i - 1] - t))


h = human().set_index("set_id")
a = algo().set_index("set_id")
rows = []
for sid in a.index:
    z = slots("human", sid)
    downs = z["t"][z["downbeat"]]
    binary = np.isin(z["snap"], [1, 2, 4, 8])
    g8 = z["t"][binary]
    g8_only = z["t"][z["snap"] == 8]
    beat = 60000.0 / np.median(z["bpm"])
    bounds = np.array(song(sid)["structure_boundaries_ms"])
    N = {w: notes(w, sid) for w in ("human", "algo")}
    for k in range(0, len(downs) - 4, 2):  # 4-bar windows, step 2 bars
        a0, b0 = downs[k], downs[k + 4]
        row = dict(set_id=sid, start=a0, end=b0, start_mmss=mmss(a0), end_mmss=mmss(b0), boundary_inside=bool(((bounds >= a0) & (bounds < b0)).any()))
        for who, nts in N.items():
            sel = [n for n in nts if a0 - 12 <= n[0] < b0 - 12]
            T = np.array([n[0] for n in sel], float)
            L = np.array([n[1] for n in sel])
            mt, cnt = np.unique(T, return_counts=True) if len(T) else (np.array([]), np.array([]))
            row[f"{who}_notes"] = len(sel)
            row[f"{who}_moments"] = len(mt)
            row[f"{who}_chords"] = int((cnt >= 2).sum())
            row[f"{who}_left"] = float((L < 2).mean()) if len(L) else np.nan
            d = grid_dist(mt, g8) if len(mt) else np.array([])
            row[f"{who}_offgrid"] = int((d > 10).sum())
            d8 = np.abs(mt[:, None] - g8_only[None, :]).min(1) if len(mt) and len(g8_only) else np.array([])
            row[f"{who}_on_1_8"] = int((d8 <= 10).sum()) if len(d8) else 0
            holds = [n for n in sel if n[2] is not None]
            busy = 0
            for t0, lane, t1 in holds:
                other = ((T > t0 + 1) & (T < t1 - 1) & ((L >> 1) != (lane >> 1))).sum()
                busy += other >= 2
            row[f"{who}_holds"] = len(holds)
            row[f"{who}_busy_holds"] = int(busy)
            rows.append(row) if who == "algo" else None
W = pd.DataFrame(rows)
W["artist"] = W.set_id.map(h["artist"])
W["title"] = W.set_id.map(h["title"])
W["density_ratio"] = W.algo_notes / W.human_notes.clip(lower=1)
W["chord_gap"] = W.human_chords - W.algo_chords
W["hand_dev"] = (W.algo_left - 0.5).abs()
W.to_csv(f"{TABLES}/candidate_windows.csv", index=False)
pd.set_option("display.width", 260); pd.set_option("display.max_columns", 40)
show = ["set_id", "artist", "title", "start_mmss", "end_mmss", "human_notes", "algo_notes", "human_chords", "algo_chords", "algo_offgrid",
        "algo_on_1_8", "algo_busy_holds", "algo_left", "boundary_inside"]
print("== gęstość: najniższy stosunek algo/human (human >= 40 nut)")
print(W[W.human_notes >= 40].sort_values("density_ratio").groupby("set_id").head(1).head(8)[show].to_string())
print("== akordy: największa różnica")
print(W.sort_values("chord_gap", ascending=False).groupby("set_id").head(1).head(8)[show].to_string())
print("== poza siatką (>10 ms od 1/8)")
print(W.sort_values("algo_offgrid", ascending=False).groupby("set_id").head(1).head(8)[show].to_string())
print("== nuty na 1/8")
print(W.sort_values("algo_on_1_8", ascending=False).groupby("set_id").head(1).head(8)[show].to_string())
print("== holdy z >= 2 nutami drugiej ręki")
print(W.sort_values("algo_busy_holds", ascending=False).groupby("set_id").head(1).head(8)[show].to_string())
print("== balans rąk")
print(W[W.algo_notes >= 30].sort_values("hand_dev", ascending=False).groupby("set_id").head(1).head(8)[show].to_string())
