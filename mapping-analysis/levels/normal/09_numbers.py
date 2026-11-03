"""Liczby do raportu: liczności map/mapperów dla tendencji, wpływ 5 oznaczonych utworów, powtarzalność.

Wynik: results/numbers.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import FLAGGED, RESULTS, algo, fmt, fmt_q, human, md_table

H = human()
A = algo()
TR = H[H.split == "train"]
TE = H[H.split == "test"]
for df in (H, TR, TE, A):
    df["long_gaps"] = sum(df[f"gap_share.{k}"] for k in ["3/2", "2", "3", "4", "6", "8"])
    df["rep_gain"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]

checks = [
    ("powtórzenie muzyki → rytm ≥ 0,8 (wśród map z parami)", lambda d: d["repetition.repeat.rhythm"] >= 0.8, "repetition.repeat.rhythm"),
    ("rytm powtórzenia − baza ≥ 0,1", lambda d: d["rep_gain"] >= 0.1, "rep_gain"),
    ("tory/lustro w powtórzeniu ≥ 0,8 (kopiowanie wzorca)", lambda d: d["repetition.repeat.lanes_or_mirror"] >= 0.8, "repetition.repeat.lanes_or_mirror"),
    ("tory w powtórzeniu > baza", lambda d: d["repetition.repeat.lanes"] > d["repetition.baseline.lanes"], "repetition.repeat.lanes"),
    ("odstępy ≥ 3/2 beatu ≤ 5% odstępów", lambda d: d["long_gaps"] <= 0.05, "long_gaps"),
    ("odstępy 1/2 to najczęstsza klasa", lambda d: d["gap_share.1/2"] >= d[["gap_share.1", "gap_share.1/4"]].max(axis=1), "gap_share.1/2"),
    ("ρ(gęstość taktu, RMS) > 0", lambda d: d["sections.bar_density_vs_rms_spearman"] > 0, "sections.bar_density_vs_rms_spearman"),
    ("akord na ≥ 50% granic sekcji", lambda d: d["sections.boundary_chord_share"] >= 0.5, "sections.boundary_chord_share"),
    ("nuta na ≥ 80% granic sekcji", lambda d: d["sections.boundary_note_share"] >= 0.8, "sections.boundary_note_share"),
    ("tryle ≤ 0,10", lambda d: d["trill_share"] <= 0.10, "trill_share"),
    ("puste takty ≤ 5%", lambda d: d["empty_bar_share"] <= 0.05, "empty_bar_share"),
    ("najdłuższa przerwa ≤ 4 beaty", lambda d: d["longest_rest_beats"] <= 4, "longest_rest_beats"),
    ("akordy ≥ 15% chwil", lambda d: d["chord_share"] >= 0.15, "chord_share"),
    ("akordy na beacie (z downbeatem) ≥ 70% akordów", lambda d: (d["chord_position_share.downbeat"] + d["chord_position_share.beat"]) >= 0.7, "chord_position_share.offbeat"),
    ("seria 1/2 ≥ 9 nut (≥ 1 takt) gdzieś w mapie", lambda d: d["run_1/2.max_notes"] >= 9, "run_1/2.max_notes"),
    ("nps 4,5–8", lambda d: d["nps"].between(4.5, 8), "nps"),
    ("holdy ≤ 35% nut", lambda d: d["hold_share"] <= 0.35, "hold_share"),
    ("kiai_density_ratio ≥ 1", lambda d: d["kiai_density_ratio"] >= 1, "kiai_density_ratio"),
]
rows = []
for name, f, col in checks:
    def cnt(d):
        v = d[col].notna()
        ok = f(d[v])
        return f"{int(ok.sum())}/{int(v.sum())}"
    bad = TR[TR[col].notna() & ~f(TR[TR[col].notna()])]
    rows.append([name, cnt(TR), f"{TR[TR[col].notna()].owner.nunique()}", cnt(TE), cnt(A), f"{bad.owner.nunique()}"])
out = ["### Tendencje: ile map spełnia (trening / test / algorytm)\n\n" +
       md_table(rows, ["warunek", "ludzie trening", "mapperów (tr)", "ludzie test", "algorytm test", "mapperów łamiących (tr)"])]

# wpływ oznaczonych utworów
fl = TR[TR.set_id.isin(FLAGGED)]
rows = []
for m in ["alignment.perc.share", "alignment.no_sound_share", "plugin_events.snare.recall", "plugin_events.lead.recall", "nps", "gap_share.1/2"]:
    rows.append([m, fmt_q(TR[m]), fmt_q(TR[~TR.set_id.isin(FLAGGED)][m]), ", ".join(f"{fmt(v)}" for v in fl[m])])
out.append(f"### 5 utworów oznaczonych w alignment.md (w treningu: {len(fl)}, w teście: {int(TE.set_id.isin(FLAGGED).sum())})\n\n" +
           md_table(rows, ["metryka", "trening wszystkie p10/p50/p90", "trening bez oznaczonych", "wartości oznaczonych"]))

# mapperzy z wieloma mapami
mc = TR.owner.value_counts()
out.append(f"Mapperzy w treningu: {TR.owner.nunique()} na {len(TR)} map; z ≥ 2 mapami: {int((mc >= 2).sum())} (maks. {int(mc.max())} mapy).")
(RESULTS / "numbers.md").write_text("\n\n".join(out))
print("\n\n".join(out))
