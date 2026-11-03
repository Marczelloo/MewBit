"""Holdy na Hard: długość, puszczenie na siatce, co gra w trakcie holda (analiza pomocnicza na nutach).
Pozycje w beatach z siatki ludzkiej (beaty tabeli slotów mapy ludzkiej, interpolacja liniowa, ekstrapolacja ostatnim beatem).
Wynik: tables/holds_per_chart.csv, tables/holds_inside_by_length.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, human, notes, slots


def beat_of(z):
    beats = z["t"][z["snap"] == 1]
    idx = np.arange(len(beats), dtype=float)
    step = np.median(np.diff(beats))

    def f(t):
        t = np.asarray(t, float)
        out = np.interp(t, beats, idx)
        out = np.where(t > beats[-1], idx[-1] + (t - beats[-1]) / step, out)
        out = np.where(t < beats[0], (t - beats[0]) / step, out)
        return out
    return f


def snap_class(pos):
    frac = pos - np.floor(pos)
    for d in (1, 2, 4, 3, 6, 8, 12, 16):
        k = np.round(frac * d) / d
        if abs(frac - k) <= 0.03:
            return d
    return 0


def analyse(who, sid, meta):
    z = slots("human", sid)
    f = beat_of(z)
    nts = sorted(notes(who, sid), key=lambda n: (n[0], n[1]))
    T = np.array([n[0] for n in nts], float)
    L = np.array([n[1] for n in nts])
    holds = [(n[0], n[1], n[2]) for n in nts if n[2] is not None]
    rows = []
    for t0, lane, t1 in holds:
        b0, b1 = f(t0), f(t1)
        length = float(b1 - b0)
        inside = (T > t0 + 1) & (T < t1 - 1)
        same_hand = inside & ((L >> 1) == (lane >> 1)) & (L != lane)
        other_hand = inside & ((L >> 1) != (lane >> 1))
        at_head = (T == t0) & (L != lane)
        rows.append(dict(len_beats=length, release_snap=snap_class(b1), head_snap=snap_class(b0),
                         inside_any=int(inside.sum()), inside_same_hand=int(same_hand.sum()), inside_other_hand=int(other_hand.sum()),
                         head_in_chord=bool(at_head.any()),
                         other_hand_per_beat=other_hand.sum() / max(length, 1e-6)))
    H = pd.DataFrame(rows)
    out = dict(who=who, set_id=sid, **meta, holds=len(H), notes=len(nts))
    if len(H):
        out.update(hold_share=len(H) / len(nts), len_p10=H.len_beats.quantile(0.1), len_p50=H.len_beats.median(), len_p90=H.len_beats.quantile(0.9),
                   release_on_1_2=np.isin(H.release_snap, [1, 2]).mean(), release_on_1_4=np.isin(H.release_snap, [1, 2, 4]).mean(),
                   release_off_binary_1_4=1 - np.isin(H.release_snap, [1, 2, 4]).mean(),
                   with_inside=(H.inside_any > 0).mean(), with_same_hand_inside=(H.inside_same_hand > 0).mean(),
                   head_in_chord=H.head_in_chord.mean(), other_hand_per_beat_p50=H.other_hand_per_beat.median())
    H["who"], H["set_id"] = who, sid
    for k, v in meta.items():
        H[k] = v
    return out, H


h = human()
a = algo()
per, allh = [], []
for _, r in h.iterrows():
    o, H = analyse("human", r.set_id, dict(split=r.split, genre=r.genre4, owner=r.owner, bpm=r.bpm))
    per.append(o); allh.append(H)
for _, r in a.iterrows():
    o, H = analyse("algo", r.set_id, dict(split="test", genre=r.genre4, owner="algo", bpm=r.bpm))
    per.append(o); allh.append(H)
P = pd.DataFrame(per)
P["grp"] = np.where(P.who == "algo", "algo_test", "human_" + P.split)
P.to_csv(f"{TABLES}/holds_per_chart.csv", index=False)
A = pd.concat(allh, ignore_index=True)
A["grp"] = np.where(A.who == "algo", "algo_test", "human_" + A.split)
A["len_cls"] = pd.cut(A.len_beats, [0, 0.374, 0.75, 1.25, 2.25, 99], labels=["<=1/4", "1/2", "1", "2", ">2"])
B = A.groupby(["grp", "len_cls"], observed=True).agg(holds=("len_beats", "size"), charts=("set_id", "nunique"),
                                                      with_inside=("inside_any", lambda x: (x > 0).mean()),
                                                      other_hand_per_beat=("other_hand_per_beat", "median"),
                                                      same_hand_inside=("inside_same_hand", lambda x: (x > 0).mean()),
                                                      head_in_chord=("head_in_chord", "mean")).reset_index()
B.to_csv(f"{TABLES}/holds_inside_by_length.csv", index=False)
pd.set_option("display.width", 250)
print(B.round(3).to_string())
cols = ["hold_share", "len_p10", "len_p50", "len_p90", "release_on_1_2", "release_on_1_4", "with_inside", "with_same_hand_inside", "head_in_chord", "other_hand_per_beat_p50"]
print(P.groupby("grp")[cols].quantile([0.1, 0.5, 0.9]).round(3).T)
print("charts with holds:", P.groupby("grp").apply(lambda d: ((d.holds > 0).sum(), len(d), (d.hold_share.fillna(0) >= 0.02).sum())))
print("release_on_1_4 min per human chart with >=10 holds:", P[(P.who == 'human') & (P.holds >= 10)].release_on_1_4.describe())
