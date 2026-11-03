"""Sections on Easy: density around structure boundaries (audio, songs/<set>.json structure_boundaries_ms), what sits on
the boundary downbeat, kiai, intro and outro. Bars and notes from the slot tables (human grid)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import OUT, metrics, q, qstr, slots, song

h = metrics("human")
a = metrics("algo")


def bars_of(z):
    df = pd.DataFrame({k: z[k] for k in ("t", "snap", "downbeat", "kiai", "bar_index", "rms", "n_notes", "mapped", "hold_start")})
    g = df.groupby("bar_index")
    bars = pd.DataFrame({
        "start": g.t.min(), "notes": g.n_notes.sum(), "moments": g.mapped.sum(), "rms": g.rms.mean(), "kiai": g.kiai.mean() > 0.5,
        "holds": g.hold_start.sum(), "beats_mapped": g.apply(lambda x: x.mapped[x.snap == 1].sum()), "nbeats": g.apply(lambda x: (x.snap == 1).sum()),
    })
    db = df[df.downbeat].groupby("bar_index").agg(db_t=("t", "first"), db_notes=("n_notes", "first"), db_hold=("hold_start", "first"))
    bars = bars.join(db, how="left")
    # last beat of each bar mapped?
    last = df[df.snap == 1].groupby("bar_index").apply(lambda x: x.sort_values("t").mapped.iloc[-1] if len(x) else np.nan)
    bars["last_beat_mapped"] = last
    return bars.reset_index()


def boundary_profile(who, df_meta):
    rows = []
    for _, r in df_meta.iterrows():
        z = slots(who, r.set_id)
        bars = bars_of(z)
        bars = bars[bars.nbeats >= 3]  # full-ish bars
        med = max(1.0, bars.notes.median())
        so = song(r.set_id)
        for b_ms in so.get("structure_boundaries_ms") or []:
            cand = bars.dropna(subset=["db_t"])
            if len(cand) == 0:
                continue
            i = (cand.db_t - b_ms).abs().idxmin()
            if abs(cand.loc[i, "db_t"] - b_ms) > 400:
                continue
            bi = cand.loc[i, "bar_index"]
            sub = bars.set_index("bar_index")
            if not all((bi + k) in sub.index for k in range(-4, 4)):
                continue
            rms_after = sub.loc[[bi + k for k in range(0, 4)], "rms"].mean()
            rms_before = sub.loc[[bi + k for k in range(-4, 0)], "rms"].mean()
            row = {"set_id": r.set_id, "split": r.split, "genre_g": r.genre_g, "owner": r.owner, "bar": bi,
                   "rms_ratio": rms_after / max(1e-9, rms_before),
                   "db_notes": sub.loc[bi, "db_notes"], "db_hold": sub.loc[bi, "db_hold"],
                   "prev_last_beat_mapped": sub.loc[bi - 1, "last_beat_mapped"], "song_med": med}
            for k in range(-4, 4):
                row[f"rel{k:+d}"] = sub.loc[bi + k, "notes"] / med
            row["prev_bar_holds"] = sub.loc[bi - 1, "holds"]
            row["prev_bar_beats_mapped_share"] = sub.loc[bi - 1, "beats_mapped"] / max(1, sub.loc[bi - 1, "nbeats"])
            rows.append(row)
    return pd.DataFrame(rows)


def summarize(bp, label):
    if len(bp) == 0:
        print(label, "no boundaries")
        return {}
    bp = bp.copy()
    bp["kind"] = np.where(bp.rms_ratio >= 1.25, "up", np.where(bp.rms_ratio <= 0.8, "down", "flat"))
    print(f"\n== {label}: boundaries {len(bp)} in {bp.set_id.nunique()} maps, mappers {bp.owner.nunique()}")
    out = {}
    for kind in ["all", "up", "flat", "down"]:
        d = bp if kind == "all" else bp[bp.kind == kind]
        if len(d) == 0:
            continue
        prof = " ".join(f"{k:+d}:{d[f'rel{k:+d}'].median():.2f}" for k in range(-4, 4))
        note_db = (d.db_notes > 0).mean()
        chord_db = (d.db_notes >= 2).mean()
        hold_db = (d.db_hold > 0).mean()
        lastbeat = d.prev_last_beat_mapped.mean()
        # per-map medians of after/before ratio
        d = d.assign(ab=(d[["rel+0", "rel+1", "rel+2", "rel+3"]].sum(axis=1)) / (d[["rel-4", "rel-3", "rel-2", "rel-1"]].sum(axis=1).clip(lower=0.25)),
                     last_prev3=d["rel-1"] / (d[["rel-4", "rel-3", "rel-2"]].mean(axis=1).clip(lower=0.1)))
        pm = d.groupby("set_id").ab.median()
        lp = d.groupby("set_id").last_prev3.median()
        print(f"  {kind:5s} n={len(d):4d} maps={d.set_id.nunique():3d}  bar notes / song median, bars -4..+3: {prof}")
        print(f"        note on boundary downbeat {note_db:.2f}, chord {chord_db:.2f}, hold start {hold_db:.2f}; last beat before boundary mapped {lastbeat:.2f}")
        print(f"        per-map median after/before {qstr(pm)}; last bar / 3 before {qstr(lp)}")
        out[kind] = dict(n=len(d), maps=d.set_id.nunique(), note=note_db, chord=chord_db, hold=hold_db, lastbeat=lastbeat, ab=q(pm), lp=q(lp),
                         prof=[d[f"rel{k:+d}"].median() for k in range(-4, 4)])
    return out


hb = boundary_profile("human", h)
ab = boundary_profile("algo", a)
hb.to_csv(OUT / "boundaries_human.csv", index=False)
ab.to_csv(OUT / "boundaries_algo.csv", index=False)
summarize(hb[hb.split == "train"], "humans train")
summarize(hb[hb.split == "test"], "humans test")
summarize(ab, "generator test")

# metric-level section stats
print("\n== section metrics (train | test | algo), p10/p50/p90")
for c in ["sections.bar_density_vs_rms_spearman", "sections.bar_density_vs_onset_rate_spearman", "sections.boundary_after_over_before_median",
          "sections.boundary_last_bar_over_prev3_median", "sections.boundary_note_share", "sections.boundary_chord_share",
          "sections.boundary_rising_density_ratio_median", "sections.boundary_falling_density_ratio_median", "kiai_density_ratio",
          "bar_notes_cv", "phrase4_notes_p90_over_p10", "empty_bar_share", "bar_notes.p10", "bar_notes.p50", "bar_notes.p90"]:
    print(f"  {c}: {qstr(h[h.split == 'train'][c])} | {qstr(h[h.split == 'test'][c])} | {qstr(a[c])}")

# kiai start: what is on the first downbeat of each kiai section; density in kiai vs outside per map
def kiai_info(who, meta):
    rows = []
    for _, r in meta.iterrows():
        z = slots(who, r.set_id)
        k = z["kiai"]
        db = z["downbeat"]
        starts = np.where(k[1:] & ~k[:-1])[0] + 1
        for s in starts:
            # first downbeat at/after the kiai start within 1 beat
            j = s
            while j < len(k) and not db[j] and z["t"][j] - z["t"][s] < 600:
                j += 1
            if j < len(k) and db[j]:
                rows.append({"set_id": r.set_id, "split": r.split, "notes": z["n_notes"][j], "hold": z["hold_start"][j]})
    return pd.DataFrame(rows)

for who, meta, lab in [("human", h[h.split == "train"], "humans train"), ("human", h[h.split == "test"], "humans test"), ("algo", a, "generator")]:
    ki = kiai_info(who, meta)
    if len(ki):
        print(f"\n== kiai starts, {lab}: n={len(ki)} in {ki.set_id.nunique()} maps; note on first downbeat {(ki.notes > 0).mean():.2f}, chord {(ki.notes >= 2).mean():.2f}, hold {(ki.hold > 0).mean():.2f}")

# intro / outro: first and last 4 full bars vs the song's median bar
def edges(who, meta):
    rows = []
    for _, r in meta.iterrows():
        bars = bars_of(slots(who, r.set_id))
        bars = bars[bars.nbeats >= 3]
        med = max(1.0, bars.notes.median())
        rows.append({"set_id": r.set_id, "split": r.split, "first4": bars.notes.iloc[:4].mean() / med, "last4": bars.notes.iloc[-4:].mean() / med,
                     "first_ms": r.first_ms})
    return pd.DataFrame(rows)

print("\n== intro/outro (first/last 4 bars of the charted span, notes per bar / song median bar)")
for who, meta, lab in [("human", h[h.split == "train"], "humans train"), ("human", h[h.split == "test"], "humans test"), ("algo", a, "generator")]:
    e = edges(who, meta)
    print(f"  {lab}: first4 {qstr(e.first4)}, last4 {qstr(e.last4)}, first note at {qstr(e.first_ms / 1000)} s")
