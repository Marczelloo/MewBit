"""Sections on Easy, metrics v2: the official boundary metrics (sections.boundary_profile_{all,rising,falling},
boundary_note/chord_share at +-25 ms, boundary_empty_last_beat_share, bar density / chords vs RMS), kiai_start.*,
rest_context.*, plus intro and outro from the slot tables (`chosen`, one slot per moment)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import metrics, q, qstr, slots

h = metrics("human")
a = metrics("algo")
groups = [("humans train", h[h.split == "train"]), ("humans test", h[h.split == "test"]), ("generator test", a)]

print("== boundary profiles: bars -4..+3 around a structure boundary, median bar notes / song median bar (p50 over maps; p10-p90 for bars -1 and 0)")
for kind in ["all", "rising", "falling"]:
    for name, d in groups:
        cols = [f"sections.boundary_profile_{kind}.{i}" for i in range(8)]
        n = d[cols[0]].notna().sum()
        prof = " ".join(f"{k:+d}:{d[c].median():.2f}" for k, c in zip(range(-4, 4), cols))
        print(f"  {kind:7s} {name:15s} n={n:3d}: {prof}   bar -1 {qstr(d[cols[3]])}, bar 0 {qstr(d[cols[4]])}")

print("\n== section and kiai metrics (p10 / p50 / p90), train | test | generator")
for c in ["sections.n_boundaries", "sections.boundary_note_share", "sections.boundary_chord_share", "sections.boundary_empty_last_beat_share",
          "sections.boundary_after_over_before_median", "sections.boundary_last_bar_over_prev3_median",
          "sections.boundary_rising_density_ratio_median", "sections.boundary_falling_density_ratio_median",
          "sections.bar_density_vs_rms_spearman", "sections.bar_chords_vs_rms_spearman", "sections.bar_density_vs_onset_rate_spearman",
          "kiai_start.n", "kiai_start.note_share", "kiai_start.chord_share", "kiai_density_ratio", "coverage.beat_kiai", "coverage.beat_no_kiai",
          "rest_context.rests_ge_4b", "rest_context.loud_share", "rest_context.rms_p50", "rest_context.at_boundary_share",
          "bar_notes_cv", "phrase4_notes_p90_over_p10", "empty_bar_share"]:
    print(f"  {c}: " + " | ".join(f"{qstr(d[c])} (n={d[c].notna().sum()})" for _, d in groups))

for name, d in groups:
    k = d.dropna(subset=["kiai_start.note_share"])
    kk = k[k["kiai_start.n"] > 0]
    tot = kk["kiai_start.n"].sum()
    print(f"  {name}: kiai starts pooled n={tot:.0f} in {len(kk)} maps: note {np.average(kk['kiai_start.note_share'], weights=kk['kiai_start.n']):.2f}, "
          f"chord {np.average(kk['kiai_start.chord_share'], weights=kk['kiai_start.n']):.2f}; maps with chord share >= 0.5: {(kk['kiai_start.chord_share'] >= 0.5).sum()}/{len(kk)}")
    print(f"  {name}: boundaries with a note >= 0.7 in {(d['sections.boundary_note_share'] >= 0.7).sum()}/{len(d)} maps; mappers {d.owner.nunique()}")


def bars_of(z):
    df = pd.DataFrame({k: z[k] for k in ("t", "snap", "bar_index", "n_notes")})
    g = df.groupby("bar_index")
    return pd.DataFrame({"notes": g.n_notes.sum(), "nbeats": g.apply(lambda x: (x.snap == 1).sum())}).reset_index()


def edges(who, meta):
    rows = []
    for _, r in meta.iterrows():
        bars = bars_of(slots(who, r.set_id))
        bars = bars[bars.nbeats >= 3]
        med = max(1.0, bars.notes.median())
        rows.append({"first4": bars.notes.iloc[:4].mean() / med, "last4": bars.notes.iloc[-4:].mean() / med, "first_ms": r.first_ms})
    return pd.DataFrame(rows)


print("\n== intro/outro (first/last 4 bars of the charted span, notes per bar / song median bar)")
for (name, d), who in zip(groups, ["human", "human", "algo"]):
    e = edges(who, d)
    print(f"  {name}: first4 {qstr(e.first4)}, last4 {qstr(e.last4)}, first note at {qstr(e.first_ms / 1000)} s")
