"""Sprawdzenia wytycznych RC/poradnika dla Hard na mapach ludzi (trening, potem test).
Wynik: tables/rc_checks.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, chosen_target, human, notes, slots, song

h = human()
rows = []
for _, r in h.iterrows():
    z = slots("human", r.set_id)
    nts = notes("human", r.set_id)
    ch, nn, _ = chosen_target(z, nts, False)
    t = z["t"]
    bounds = np.array(song(r.set_id)["structure_boundaries_ms"])
    on_b = np.array([np.min(np.abs(bounds - x)) <= 30 if len(bounds) else False for x in t])
    tri = ch & (nn >= 3)
    rows.append(dict(set_id=r.set_id, split=r.split, owner=r.owner, bpm=r.bpm,
                     triples=int(tri.sum()),
                     triples_on_downbeat=float(z["downbeat"][tri].mean()) if tri.any() else np.nan,
                     triples_on_boundary=float(on_b[tri].mean()) if tri.any() else np.nan,
                     boundary_slots_share=float(on_b[ch].mean()) if ch.any() else np.nan,
                     triples_in_kiai=float(z["kiai"][tri].mean()) if tri.any() else np.nan,
                     kiai_share=float(z["kiai"][ch].mean()),
                     run18=r["run_1/8.max_notes"], run14=r["run_1/4.max_notes"], run16=r["run_1/6.max_notes"],
                     anchor=r["anchor_max_notes"], anchor_rc=r["anchor_rc_max_notes"], chords_fast=r["chords_in_fast_stream_per_min"],
                     cp_pairs=r["chord_pairs_in_quarter_streams.pairs"], cp_close=r["chord_pairs_in_quarter_streams.closer_than_1_beat_share"],
                     trill_max=r["trills.max_notes"]))
R = pd.DataFrame(rows)
R.to_csv(f"{TABLES}/rc_checks.csv", index=False)
for split in ["train", "test"]:
    d = R[R.split == split]
    print(split, "maps", len(d))
    print("  run_1/8 > 3:", (d.run18 > 3).sum(), "BPM of those:", sorted(d[d.run18 > 3].bpm.tolist()))
    print("  run_1/4 > 64 (więcej niż fraza 4 taktów 4/4 bez pauzy):", (d.run14 > 64).sum(), sorted(d[d.run14 > 64].bpm.tolist()))
    print("  run_1/6 > 3 (dłużej niż 1/2 beatu):", (d.run16 > 4).sum())
    print("  anchor >= 5:", (d.anchor >= 5).mean().round(2), "p50", d.anchor.median(), "| anchor_rc >= 5:", (d.anchor_rc >= 5).mean().round(2),
          "p50", d.anchor_rc.median(), "p90", d.anchor_rc.quantile(0.9), ">= 9:", (d.anchor_rc >= 9).mean().round(2))
    c = d[d.cp_pairs > 0]
    print("  official chord pairs in 1/4 streams: maps with pairs", len(c), "closer<1 beat p50 %.2f, maps with share>0.5: %.2f" % (c.cp_close.median(), (c.cp_close > 0.5).mean()))
    print("  trills.max_notes > 9:", (d.trill_max > 9).sum())
    t = d[d.triples >= 3]
    print("  maps with >=3 triples:", len(t), "triples on downbeat p50 %.2f, on section boundary p50 %.2f vs all moments on boundary p50 %.3f, in kiai p50 %.2f vs moments in kiai %.2f"
          % (t.triples_on_downbeat.median(), t.triples_on_boundary.median(), t.boundary_slots_share.median(), t.triples_in_kiai.median(), t.kiai_share.median()))

# RC Hard: "Chords within 1/4 streams should be at least 1/1 beat apart" -- gaps between chords inside 1/4 streams
def beat_of(z):
    beats = z["t"][z["snap"] == 1]
    return lambda t: np.interp(t, beats, np.arange(len(beats), dtype=float))


from common import algo
rows2 = []
for who, df in [("human", h), ("algo", algo().assign(owner="algo"))]:
    for _, r in df.iterrows():
        z = slots("human", r.set_id)
        f = beat_of(z)
        m = {}
        for n in notes(who, r.set_id):
            m[n[0]] = m.get(n[0], 0) + 1
        T = np.array(sorted(m), float)
        C = np.array([m[t] >= 2 for t in T])
        P = f(T)
        g = np.diff(P)
        q = np.abs(g - 0.25) <= 0.03
        gaps = []
        i = 0
        while i < len(q):
            j = i
            while j < len(q) and q[j]:
                j += 1
            if j - i >= 4:  # stream of >= 5 moments
                idx = np.arange(i, j + 1)
                inner = idx[1:-1]  # chords at the very start/end are fine
                cp = P[inner][C[inner]]
                gaps += list(np.diff(cp))
            i = j + 1
        gaps = np.array(gaps)
        rows2.append(dict(who=who, set_id=r.set_id, split=getattr(r, "split", "algo") if who == "human" else "algo",
                          chord_pairs=len(gaps), share_closer_than_1=float((gaps < 0.99).mean()) if len(gaps) else np.nan))
R2 = pd.DataFrame(rows2)
R2.to_csv(f"{TABLES}/rc_chords_in_streams.csv", index=False)
for k, d in R2.groupby("split"):
    d = d.dropna()
    print(k, "charts with chord pairs inside 1/4 streams:", len(d), "share of pairs < 1 beat apart p10/p50/p90:",
          d.share_closer_than_1.quantile([0.1, 0.5, 0.9]).round(2).tolist(), "charts with share > 0.5:", (d.share_closer_than_1 > 0.5).mean().round(2))
