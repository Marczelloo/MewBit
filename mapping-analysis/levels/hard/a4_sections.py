"""Sekcje, wstęp, zakończenie, kiai i kontrast na Hard.
Takty = downbeaty siatki ludzkiej (tabela slotów mapy ludzkiej). Granice = songs/<set>.json structure_boundaries_ms.
Wynik: tables/sections_profile.csv (gęstość taktów -4..+3 wokół granicy, względem mediany utworu),
       tables/sections_events.csv (co jest na downbeacie granicy i w takcie przed nią), tables/intro_outro.csv
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd

from common import TABLES, algo, chosen_target, human, notes, slots, song


def bar_table(z, nts, binary_first):
    """Per bar of the human grid inside the slot table: notes, moments, chords, 1/4 moments, rms, kiai, holds."""
    chosen, nn, _ = chosen_target(z, nts, binary_first)
    downs = z["t"][z["downbeat"]]
    if len(downs) < 2:
        return None
    nt = np.array([n[0] for n in nts], float)
    holds = np.array([n[2] is not None for n in nts])
    rows = []
    for k in range(len(downs) - 1):
        a, b = downs[k], downs[k + 1]
        sl = (z["t"] >= a - 1) & (z["t"] < b - 1)
        inbar = (nt >= a - 12) & (nt < b - 12)
        rows.append(dict(bar=k, start=a, end=b, notes=int(inbar.sum()), holds=int((inbar & holds).sum()),
                         moments=int(chosen[sl].sum()), chords=int((chosen[sl] & (nn[sl] >= 2)).sum()),
                         q_moments=int((chosen[sl] & (z["snap"][sl] == 4)).sum()),
                         beat_moments=int((chosen[sl] & (z["snap"][sl] == 1)).sum()),
                         beats=int((z["snap"][sl] == 1).sum()),
                         rms=float(np.mean(z["rms"][sl])) if sl.any() else np.nan,
                         kiai=float(np.mean(z["kiai"][sl])) if sl.any() else 0.0,
                         downbeat_note=bool(chosen[np.argmin(np.abs(z["t"] - a))]),
                         downbeat_chord=bool(nn[np.argmin(np.abs(z["t"] - a))] >= 2)))
    return pd.DataFrame(rows)


def analyse(who, sid, meta, grid_bars=None):
    z = slots("human", sid) if who == "human" else slots("algo", sid)
    bt = bar_table(z, notes(who, sid), binary_first=(who == "algo"))
    if bt is None or len(bt) < 8:
        return [], [], None
    med = np.median(bt.notes[bt.notes > 0]) if (bt.notes > 0).any() else np.nan
    bt["rel"] = bt.notes / med
    bounds = song(sid)["structure_boundaries_ms"]
    prof, ev = [], []
    for b in bounds:
        k = int(np.argmin(np.abs(bt.start.values - b)))
        if abs(bt.start.values[k] - b) > 60 or k < 4 or k + 4 > len(bt):
            continue
        before, after = bt.iloc[k - 4:k], bt.iloc[k:k + 4]
        r_rms = after.rms.mean() / max(1e-6, before.rms.mean())
        kind = "w górę" if r_rms >= 1.25 else ("w dół" if r_rms <= 0.8 else "płaska")
        kiai_in = before.kiai.mean() < 0.5 <= after.kiai.mean()
        for off in range(-4, 4):
            row = bt.iloc[k + off]
            prof.append(dict(who=who, set_id=sid, kind=kind, kiai_start=kiai_in, offset=off, rel=row.rel,
                             chord_share=row.chords / row.moments if row.moments else np.nan,
                             q_share=row.q_moments / row.moments if row.moments else np.nan, **meta))
        last = bt.iloc[k - 1]
        prev3 = bt.iloc[k - 4:k - 1]
        ev.append(dict(who=who, set_id=sid, kind=kind, kiai_start=kiai_in, rms_ratio=r_rms,
                       note_on_boundary=bt.iloc[k].downbeat_note, chord_on_boundary=bt.iloc[k].downbeat_chord,
                       last_bar_rel_prev3=last.notes / max(1e-6, prev3.notes.mean()),
                       last_bar_q_minus_prev3=(last.q_moments / max(1, last.moments)) - (prev3.q_moments.sum() / max(1, prev3.moments.sum())),
                       last_bar_beats_mapped=last.beat_moments / max(1, last.beats),
                       after_over_before=after.notes.mean() / max(1e-6, before.notes.mean()),
                       empty_bar_before=bool((before.notes == 0).any()), **meta))
    # intro / outro: first and last 4 bars of the chart's own span (bars with notes)
    nz = bt[bt.notes > 0]
    io = dict(who=who, set_id=sid, **meta, bars=len(bt), median_bar_notes=med,
              intro4_rel=nz.head(4).notes.mean() / med if len(nz) >= 8 else np.nan,
              outro4_rel=nz.tail(4).notes.mean() / med if len(nz) >= 8 else np.nan,
              first_bar_rel=nz.iloc[0].notes / med if len(nz) else np.nan,
              last_bar_rel=nz.iloc[-1].notes / med if len(nz) else np.nan,
              first_section_rel=np.nan, kiai_rel=np.nan)
    if bounds:
        first = bt[bt.start < bounds[0] - 1]
        first = first[first.notes > 0]
        io["first_section_rel"] = first.notes.mean() / med if len(first) else np.nan
    if (bt.kiai >= 0.5).any() and (bt.kiai < 0.5).any():
        io["kiai_rel"] = bt[bt.kiai >= 0.5].notes.mean() / max(1e-6, bt[bt.kiai < 0.5].notes.mean())
        io["kiai_chord_share"] = bt[bt.kiai >= 0.5].chords.sum() / max(1, bt[bt.kiai >= 0.5].moments.sum())
        io["nonkiai_chord_share"] = bt[bt.kiai < 0.5].chords.sum() / max(1, bt[bt.kiai < 0.5].moments.sum())
    # correlation of bar density with bar rms (bars with rms)
    ok = bt.rms.notna()
    io["bar_notes_vs_rms_spearman"] = bt[ok].notes.rank().corr(bt[ok].rms.rank())
    io["bar_chords_vs_rms_spearman"] = bt[ok].chords.rank().corr(bt[ok].rms.rank())
    return prof, ev, io


h = human()
a = algo()
P, E, I = [], [], []
for _, r in h.iterrows():
    p, e, io = analyse("human", r.set_id, dict(split=r.split, genre=r.genre4, owner=r.owner, bpm=r.bpm))
    P += p; E += e
    if io: I.append(io)
for _, r in a.iterrows():
    p, e, io = analyse("algo", r.set_id, dict(split="test", genre=r.genre4, owner="algo", bpm=r.bpm))
    P += p; E += e
    if io: I.append(io)
P, E, I = pd.DataFrame(P), pd.DataFrame(E), pd.DataFrame(I)
P.to_csv(f"{TABLES}/sections_bars_long.csv", index=False)
E.to_csv(f"{TABLES}/sections_events.csv", index=False)
I.to_csv(f"{TABLES}/intro_outro.csv", index=False)

# summaries
P["grp"] = np.where(P.who == "algo", "algo_test", "human_" + P.split)
E["grp"] = np.where(E.who == "algo", "algo_test", "human_" + E.split)
I["grp"] = np.where(I.who == "algo", "algo_test", "human_" + I.split)
# per-song median, then quantiles across songs
song_prof = P.groupby(["grp", "kind", "offset", "set_id"]).rel.median().reset_index()
summ = song_prof.groupby(["grp", "kind", "offset"]).rel.agg(songs="count", p10=lambda x: x.quantile(0.1), p50="median",
                                                             p90=lambda x: x.quantile(0.9)).reset_index()
summ.to_csv(f"{TABLES}/sections_profile.csv", index=False)
pd.set_option("display.width", 220)
print(summ.pivot_table(index=["grp", "kind"], columns="offset", values="p50").round(2))
print(summ.groupby(["grp", "kind"]).songs.max())
es = E.groupby(["grp", "kind"]).agg(n=("set_id", "size"), songs=("set_id", "nunique"), note=("note_on_boundary", "mean"),
                                    chord=("chord_on_boundary", "mean"), last_rel=("last_bar_rel_prev3", "median"),
                                    last_q=("last_bar_q_minus_prev3", "median"), after_before=("after_over_before", "median"),
                                    empty_before=("empty_bar_before", "mean"))
print(es.round(3))
es.reset_index().to_csv(f"{TABLES}/sections_events_summary.csv", index=False)
cols = ["intro4_rel", "outro4_rel", "first_bar_rel", "last_bar_rel", "first_section_rel", "kiai_rel", "kiai_chord_share",
        "nonkiai_chord_share", "bar_notes_vs_rms_spearman", "bar_chords_vs_rms_spearman"]
iq = I.groupby("grp")[cols].quantile([0.1, 0.5, 0.9]).round(2)
print(iq.T)
iq.to_csv(f"{TABLES}/intro_outro_summary.csv")
