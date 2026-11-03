"""Algorytm vs ludzie na 20 utworach testowych (Normal).

1. Tabela kluczowych metryk: ludzie test p10/p50/p90 vs algorytm p10/p50/p90 (+ ludzie trening dla kontekstu).
2. Podział wg relacji tempa algorytmu do siatki ludzkiej (songs/<set>.json → algo_beat_tracking, algo_tempo):
   „odczuwany beat algorytmu = 2 beaty ludzkie” (beat tracker w połowie tempa albo siatka podwojona przez foldTempo,
   bo feltBeatMs w difficultyFilter.js mnoży beat przez foldFactor), „1:1”, „bez siatki”.
3. Tabela per utwór.
4. Okna 4-taktowe (takty siatki ludzkiej): gdzie algorytm najbardziej odbiega → kandydaci do testów odsłuchowych.

Wynik: results/algo_vs_human.md, results/windows.csv, results/candidates.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from scipy import stats

from common import RESULTS, algo, fmt, fmt_q, human, md_table, mmss, notes, slots, song

H = human()
A = algo()
HT = H[H.split == "test"].set_index("set_id").loc[A.set_id]
HTR = H[H.split == "train"]
AT = A.set_index("set_id")

# --- relacja tempa ----------------------------------------------------------------------------------------------------
rel = {}
for sid in AT.index:
    s = song(sid)
    bt = s["algo_beat_tracking"]
    if not bt.get("snapped"):
        rel[sid] = "bez siatki (NO_TIMING)"
        continue
    ratio = bt.get("human_beat_over_algo_beat")
    fold = bt.get("fold_factor") or 1
    felt = (1 / ratio if ratio else 1) * max(1, fold)  # odczuwany beat algorytmu w beatach ludzkich
    rel[sid] = "odczuwany beat = 2 beaty ludzkie" if felt > 1.5 else "1:1"
AT["tempo_rel"] = pd.Series(rel)
HT["tempo_rel"] = pd.Series(rel)

KEY = [
    ("nps", "nuty/s"), ("mps", "chwile/s"), ("notes_per_beat", "nuty/beat"), ("nps_window.p90", "nuty/s okno 2 s p90"), ("nps_window.max", "nuty/s okno 2 s max"),
    ("gap_share.1/2", "odstępy 1/2"), ("gap_share.1", "odstępy 1/1"), ("gap_share.3/2", "odstępy 3/2"), ("gap_share.2", "odstępy 2"),
    ("gap_share.1/4", "odstępy 1/4"), ("gap_share.other", "odstępy poza klasami"),
    ("run_1/2.max_notes", "najdłuższa seria 1/2 [nuty]"), ("run_1/2.p90_notes", "seria 1/2 p90 [nuty]"), ("run_1/4.max_notes", "najdłuższa seria 1/4"),
    ("snap_share.1", "chwile na beacie"), ("snap_share.2", "chwile na 1/2"), ("snap_share.off", "chwile poza siatką"), ("triplet_share", "chwile na 1/3, 1/6"),
    ("downbeats_carried", "downbeaty z nutą"), ("gap_ms.min", "min. odstęp [ms]"),
    ("chord_share", "udział akordów"), ("chord_position_share.offbeat", "akordy poza beatem"), ("chord_position_share.downbeat", "akordy na downbeacie"),
    ("minijack_share", "minijacki"), ("minijack_gap_beats.p50", "odstęp minijacka p50 [beat]"), ("jack_max_notes", "najdłuższy jack"),
    ("hold_share", "udział holdów"), ("hold_len_beats.p50", "długość holda p50 [beat]"), ("hold_short_share.lt_1", "holdy < 1 beat"),
    ("holds_with_notes_inside_share", "holdy z nutą w trakcie"), ("other_hand_notes_per_beat_in_hold.p50", "nuty drugiej ręki/beat w holdzie p50"),
    ("release_snap_share.1", "puszczenie na beacie"), ("release_snap_share.2", "puszczenie na 1/2"), ("max_simultaneous_holds", "maks. holdów naraz"),
    ("trill_share", "tryle x-y-x"), ("stair_share", "schody"), ("pattern4_entropy_bits", "entropia 4-chwil [bit]"),
    ("rests_ge_2b.per_min", "przerwy ≥ 2 beaty /min"), ("rests_ge_4b.per_min", "przerwy ≥ 4 beaty /min"), ("longest_rest_beats", "najdłuższa przerwa [beat]"),
    ("bar_notes_cv", "CV nut na takt"), ("phrase4_notes_p90_over_p10", "kontrast 4 taktów p90/p10"), ("empty_bar_share", "puste takty"),
    ("kiai_density_ratio", "gęstość kiai / reszta"),
    ("alignment.no_sound_share", "chwile bez dźwięku"), ("alignment.perc.share", "chwile na onsecie perk."),
    ("plugin_events.snare.recall", "recall snare"), ("plugin_events.kick.recall", "recall kick"), ("plugin_events.lead.recall", "recall lead"),
    ("plugin_events.bass.recall", "recall bass"), ("plugin_events.hat.recall", "recall hat"),
    ("repetition.repeat.rhythm", "powtórzenie: rytm"), ("repetition.baseline.rhythm", "baza: rytm"), ("repetition.repeat.lanes_or_mirror", "powtórzenie: tory/lustro"),
    ("sections.boundary_chord_share", "akord na granicy sekcji"), ("sections.boundary_note_share", "nuta na granicy (tol. siatki)"),
    ("sections.boundary_rising_density_ratio_median", "gęstość po/przed, granice w górę"),
    ("sections.bar_density_vs_rms_spearman", "ρ nuty~RMS taktu"),
]
rows = []
for m, name in KEY:
    hv = pd.to_numeric(HT[m], errors="coerce")
    av = pd.to_numeric(AT[m], errors="coerce")
    d = (av - hv).dropna()
    try:
        p = stats.wilcoxon(av.loc[d.index], hv.loc[d.index]).pvalue if len(d) >= 6 and (d != 0).any() else np.nan
    except ValueError:
        p = np.nan
    rows.append([name, f"`{m}`", fmt_q(HTR[m]), fmt_q(hv), fmt_q(av), f"{int((d < 0).sum())}/{int((d > 0).sum())}", fmt(p, 3)])
out = ["### 1. Ludzie (test, n=20 map, 20 mapperów) vs algorytm (te same 20 utworów), p10 / p50 / p90\n\n" +
       md_table(rows, ["metryka", "klucz", "ludzie trening (78)", "ludzie test", "algorytm test", "algo < / > człowiek (utwory)", "Wilcoxon p"])]

# --- 2. relacja tempa --------------------------------------------------------------------------------------------------
G = ["odczuwany beat = 2 beaty ludzkie", "1:1", "bez siatki (NO_TIMING)"]
TM = ["nps", "notes_per_beat", "gap_share.1/2", "gap_share.1", "run_1/2.max_notes", "minijack_gap_beats.p50", "chord_share", "chord_position_share.offbeat",
      "downbeats_carried", "snap_share.off", "triplet_share", "hold_len_beats.p50", "repetition.repeat.rhythm"]
rows = []
for m in TM:
    cells = [m]
    for g in G:
        ids = AT.index[AT.tempo_rel == g]
        cells.append(f"{fmt(pd.to_numeric(HT.loc[ids, m], errors='coerce').median())} → {fmt(pd.to_numeric(AT.loc[ids, m], errors='coerce').median())}")
    rows.append(cells)
hdr = ["metryka (ludzie p50 → algorytm p50)"] + [f"{g} (n={int((AT.tempo_rel == g).sum())})" for g in G]
out.append("### 2. Wg relacji tempa algorytmu do siatki ludzkiej\n\n" + md_table(rows, hdr))
# Mann-Whitney między dwiema głównymi grupami dla algorytmu
mw = []
for m in ["run_1/2.max_notes", "gap_share.1/2", "minijack_gap_beats.p50", "notes_per_beat"]:
    a = pd.to_numeric(AT.loc[AT.tempo_rel == G[0], m], errors="coerce").dropna()
    b = pd.to_numeric(AT.loc[AT.tempo_rel == G[1], m], errors="coerce").dropna()
    mw.append(f"{m}: p={stats.mannwhitneyu(a, b).pvalue:.3f}")
out.append("Mann–Whitney (algorytm, grupa „2 beaty” vs „1:1”): " + "; ".join(mw))

# --- 3. per utwór ---------------------------------------------------------------------------------------------------------
rows = []
for sid in AT.index:
    s = song(sid)
    bt = s["algo_beat_tracking"]
    a, h = AT.loc[sid], HT.loc[sid]
    rows.append([sid, f"{a.artist} – {a.title}"[:48], a.genre, fmt(s["main_bpm"]), f"{s['algo_tempo']['bpm']:.0f}×{bt.get('fold_factor') or '—'}",
                 a.tempo_rel.replace("odczuwany beat = 2 beaty ludzkie", "2 beaty").replace("bez siatki (NO_TIMING)", "brak"),
                 fmt(bt.get("downbeat_on_human_downbeat_share")), f"{fmt(h.nps)} / {fmt(a.nps)}", f"{fmt(h['gap_share.1/2'])} / {fmt(a['gap_share.1/2'])}",
                 f"{int(h['run_1/2.max_notes'])} / {int(a['run_1/2.max_notes'])}", f"{fmt(h.chord_share)} / {fmt(a.chord_share)}",
                 f"{fmt(h.holds_with_notes_inside_share)} / {fmt(a.holds_with_notes_inside_share)}",
                 f"{fmt(h['repetition.repeat.rhythm'])} / {fmt(a['repetition.repeat.rhythm'])}",
                 ",".join(f"{k}:{v}" for k, v in pd.Series(s["algo_leaders"]).value_counts().items())])
out.append("### 3. Per utwór (człowiek / algorytm)\n\n" + md_table(rows, ["set", "utwór", "gatunek", "BPM ludzi", "BPM algo × fold", "relacja",
                                                                        "downbeat algo na ludzkim", "nps", "gap 1/2", "maks. seria 1/2",
                                                                        "akordy", "holdy z nutą w środku", "powt. rytm", "liderzy fraz"]))
(RESULTS / "algo_vs_human.md").write_text("\n\n".join(out))
print("\n\n".join(out))

# --- 4. okna 4-taktowe ------------------------------------------------------------------------------------------------------
W = []
for sid in AT.index:
    hs, as_ = slots("human", sid), slots("algo", sid)
    hn, an = notes("human", sid), notes("algo", sid)
    db = np.unique(np.round(np.concatenate([hs["t"][hs["downbeat"]], as_["t"][as_["downbeat"]]]), 1))
    bounds = song(sid)["structure_boundaries_ms"]
    # tabela slotów połączona (siatka ta sama): pozycja i kiai
    grid_t = np.concatenate([hs["t"], as_["t"]])
    grid_snap = np.concatenate([hs["snap"], as_["snap"]])
    grid_kiai = np.concatenate([hs["kiai"], as_["kiai"]])
    order = np.argsort(grid_t)
    grid_t, grid_snap, grid_kiai = grid_t[order], grid_snap[order], grid_kiai[order]
    def snap_of(t):
        i = np.clip(np.searchsorted(grid_t, t), 1, len(grid_t) - 1)
        j = np.where(np.abs(grid_t[i - 1] - t) < np.abs(grid_t[i] - t), i - 1, i)
        return np.where(np.abs(grid_t[j] - t) <= 12, grid_snap[j], 0), grid_kiai[j]
    first = max(hn[:, 0].min(), an[:, 0].min())
    last = min(np.nanmax(hn[:, 0]), np.nanmax(an[:, 0]))
    for k in range(0, len(db) - 4, 2):  # okna 4 takty co 2 takty
        a0, a1 = db[k], db[k + 4]
        if a0 < first or a1 > last:
            continue
        def stats_of(n):
            m = (n[:, 0] >= a0) & (n[:, 0] < a1)
            t = n[m, 0]
            mt, cnt = np.unique(t, return_counts=True)
            sn, ki = snap_of(mt) if len(mt) else (np.array([]), np.array([]))
            holds = n[m & ~np.isnan(n[:, 2])]
            inside = 0
            for h in holds:
                inside += int(((n[:, 0] > h[0]) & (n[:, 0] < h[2]) & ((n[:, 1].astype(int) >> 1) != (int(h[1]) >> 1))).any())
            return dict(notes=int(m.sum()), moments=len(mt), chords=int((cnt >= 2).sum()), half=int((sn == 2).sum()), beat=int((sn == 1).sum()),
                        offgrid=int((~np.isin(sn, [1, 2, 4])).sum()), holds=len(holds), holds_inside=inside, kiai=float(np.mean(ki)) if len(ki) else 0.0)
        h, a = stats_of(hn), stats_of(an)
        n_beats = int(((grid_t >= a0) & (grid_t < a1) & (grid_snap == 1)).sum() / 2)  # siatka z dwóch tabel: każdy beat dwa razy
        W.append(dict(set_id=sid, t0=a0, t1=a1, boundary=any(a0 <= b < a1 for b in bounds), **{f"h_{k2}": v for k2, v in h.items()},
                      **{f"a_{k2}": v for k2, v in a.items()}, beats=n_beats))
W = pd.DataFrame(W)
W["density_ratio"] = (W.a_notes + 1) / (W.h_notes + 1)
W["half_deficit"] = W.h_half - W.a_half
W["chord_deficit"] = W.h_chords - W.a_chords
W.to_csv(RESULTS / "windows.csv", index=False)

meta = AT[["artist", "title", "genre", "tempo_rel"]]
c = []
def pick(df, key, n, why, asc=False):
    d = df.sort_values(key, ascending=asc)
    used = set(x["set_id"] for x in c)
    for r in d.itertuples():
        if r.set_id in used:
            continue
        c.append(dict(set_id=r.set_id, t0=r.t0, t1=r.t1, why=why(r)))
        used.add(r.set_id)
        if sum(1 for x in c if x["why"].startswith(why(r).split(":")[0])) >= n:
            break

pick(W[W.h_kiai > 0.5], "density_ratio", 3, lambda r: f"Gęstość w kiai: człowiek {r.h_notes} nut ({r.h_half} chwil na 1/2, {r.h_chords} akordów), "
     f"algorytm {r.a_notes} nut ({r.a_half} na 1/2, {r.a_chords} akordów) w 4 taktach", asc=True)
pick(W[W.boundary], "chord_deficit", 2, lambda r: f"Granica sekcji: człowiek {r.h_chords} akordów i {r.h_notes} nut, algorytm {r.a_chords} akordów i {r.a_notes} nut; "
     f"posłuchać, czy wejście nowej sekcji jest zaznaczone")
pick(W, "a_holds_inside", 2, lambda r: f"Holdy algorytmu z nutami drugiej ręki w środku: {r.a_holds_inside} z {r.a_holds} (człowiek {r.h_holds_inside} z {r.h_holds}); "
     f"sprawdzić czytelność i puszczenia poza siatką")
pick(W, "a_offgrid", 2, lambda r: f"Chwile algorytmu poza 1/1, 1/2, 1/4 siatki ludzkiej: {r.a_offgrid} z {r.a_moments} (człowiek {r.h_offgrid}); "
     f"sprawdzić, czy nuty nie „pływają” względem bitu")
rows = []
for x in c:
    m = meta.loc[x["set_id"]]
    rows.append([x["set_id"], f"{m.artist} – {m.title}", m.genre, m.tempo_rel, f"{mmss(x['t0'])}–{mmss(x['t1'])}", x["why"]])
(RESULTS / "candidates.md").write_text(md_table(rows, ["set", "utwór", "gatunek", "relacja tempa", "czas (oś audio)", "co widać w danych"]))
print(md_table(rows, ["set", "utwór", "gatunek", "relacja tempa", "czas (oś audio)", "co widać w danych"]))
