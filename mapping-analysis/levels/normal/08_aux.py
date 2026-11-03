"""Pomiary pomocnicze z nut (nie są oficjalnymi metrykami).

Po metrykach v2 raport używa oficjalnych odpowiedników: `chords_in_half_runs_per_min` (akordy w strumieniu 1/2),
`hand_by_class.*` (ręka wg dźwięku), `rest_context.*` (kontekst przerw ≥ 4 beaty). Ze skryptu raport bierze już tylko
udział torów zewnętrznych dla kicka/snare i liczbę nut algorytmu w przerwach człowieka (brak oficjalnych odpowiedników).

- akordy z sąsiednią chwilą bliżej niż 0,9 beatu (to, co spaceChords w kodzie Normal usuwa przy „odczuwanym beacie” = 2 beaty ludzkie),
- udział beatów siatki ludzkiej z chwilą (pokrycie beatów) i półbeatów,
- odstęp nuta→nuta w ms w oknach 1/2-strumienia: najkrótszy powtarzalny odstęp (p5) względem BPM.
Wynik: results/auxiliary.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

from common import RESULTS, algo, fmt_q, human, md_table, notes, slots


def chord_neighbours(who, sid):
    n = notes(who, sid)
    s = slots(who, sid)
    t, c = np.unique(n[:, 0], return_counts=True)
    if len(t) < 3:
        return np.nan, np.nan
    i = np.clip(np.searchsorted(s["t"], t), 0, len(s["t"]) - 1)
    beat = 60000.0 / s["bpm"][i]
    prev = np.r_[np.inf, np.diff(t)] / beat
    nxt = np.r_[np.diff(t), np.inf] / beat
    near = np.minimum(prev, nxt)
    ch = c >= 2
    if ch.sum() == 0:
        return np.nan, np.nan
    return float(np.mean(near[ch] < 0.9)), float(np.mean(np.abs(near[ch] - 0.5) < 0.05))


rows = []
H = human()
A = algo()
res = []
for df, who in ((H, "human"), (A, "algo")):
    for r in df.itertuples():
        a, b = chord_neighbours(who, r.set_id)
        res.append(dict(who=who, split=r.split if who == "human" else "algo", set_id=r.set_id, chord_near=a, chord_half=b))
R = pd.DataFrame(res)
lab = {"train": "ludzie trening", "test": "ludzie test", "algo": "algorytm test"}
for sp in ["train", "test", "algo"]:
    sub = R[R.split == sp]
    rows.append([lab[sp], len(sub), fmt_q(sub.chord_near), fmt_q(sub.chord_half)])
txt = "### Akordy a sąsiednie chwile (na mapę, p10/p50/p90)\n\n" + md_table(rows, ["grupa", "map", "akordy z sąsiadem < 0,9 beatu", "akordy z sąsiadem w odstępie 1/2 beatu"])
(RESULTS / "auxiliary.md").write_text(txt)
print(txt)


# --- „pitch relevancy” z poradnika: czy niskie dźwięki idą na lewą rękę, wysokie na prawą ------------------------------
def hand_by_sound(who, sid):
    n = notes(who, sid)
    s = slots(who, sid)
    out = []
    for t in np.unique(n[:, 0]):
        here = n[n[:, 0] == t]
        if len(here) != 1:
            continue  # tylko pojedyncze nuty
        i = np.argmin(np.abs(s["t"] - t))
        if abs(s["t"][i] - t) > 12:
            continue
        lane = int(here[0, 1])
        out.append(dict(left=lane < 2, outer=lane in (0, 3), kick=s["ev_kick"][i] > 0, snare=s["ev_snare"][i] > 0, bass=s["ev_bass"][i] > 0,
                        lead=s["ev_lead"][i] > 0, low=s["ev_low"][i] > 0 and s["ev_high"][i] == 0, high=s["ev_high"][i] > 0 and s["ev_low"][i] == 0,
                        vocal=bool(s["onset_stem_vocals"][i]) and not s["onset_stem_drums"][i], drums=bool(s["onset_stem_drums"][i]) and not s["onset_stem_vocals"][i]))
    return pd.DataFrame(out)


rows = []
for df, who, sp in ((H[H.split == "train"], "human", "ludzie trening"), (H[H.split == "test"], "human", "ludzie test"), (A, "algo", "algorytm test")):
    per = []
    for r in df.itertuples():
        d = hand_by_sound(who, r.set_id)
        if len(d) < 50:
            continue
        rec = {}
        for k in ["kick", "snare", "bass", "lead", "low", "high", "vocal", "drums"]:
            sub = d[d[k]]
            rec[k] = sub.left.mean() if len(sub) >= 10 else np.nan
            rec[k + "_outer"] = sub.outer.mean() if len(sub) >= 10 else np.nan
        per.append(rec)
    P = pd.DataFrame(per)
    rows.append([sp, len(P)] + [fmt_q(P[k]) for k in ["kick", "snare", "bass", "lead", "low", "high", "vocal"]] + [fmt_q(P["kick_outer"]), fmt_q(P["snare_outer"])])
txt2 = ("### Pojedyncze nuty: udział lewej ręki wg dźwięku w slocie (na mapę, p10/p50/p90); ostatnie dwie kolumny: udział torów zewnętrznych 0/3\n\n" +
        md_table(rows, ["grupa", "map", "kick", "snare", "bass", "lead", "tylko pasmo low", "tylko pasmo high", "tylko stem wokalu", "kick: tory 0/3", "snare: tory 0/3"]))
(RESULTS / "auxiliary.md").write_text(txt + "\n\n" + txt2)
print(txt2)


# --- długie przerwy ludzi (≥ 4 beaty): gdzie są i co algorytm robi w tym miejscu --------------------------------------
from common import song


def long_rests(who, sid):
    n = notes(who, sid)
    s = slots("human", sid) if who == "human" else slots("algo", sid)
    t = np.unique(n[:, 0])
    ends = np.array([np.nanmax(np.where(np.isnan(n[n[:, 0] == x, 2]), x, n[n[:, 0] == x, 2])) for x in t])
    run_end = np.maximum.accumulate(ends)
    med_rms = np.median(s["rms"])
    bounds = np.array(song(sid)["structure_boundaries_ms"])
    out = []
    for i in range(len(t) - 1):
        a, b = run_end[i], t[i + 1]
        j = np.clip(np.searchsorted(s["t"], a), 0, len(s["t"]) - 1)
        beat = 60000.0 / s["bpm"][j]
        if (b - a) / beat >= 4 - 1e-6:
            m = (s["t"] >= a) & (s["t"] < b)
            rms = s["rms"][m].mean() / med_rms if m.any() else np.nan
            near = bool(len(bounds) and np.min(np.abs(bounds - b)) <= 4 * 4 * beat)  # do 4 taktów przed granicą lub po niej
            out.append(dict(set_id=sid, a=a, b=b, beats=(b - a) / beat, rms_rel=rms, near_boundary=near))
    return out


LR = []
for r in H.itertuples():
    for x in long_rests("human", r.set_id):
        x["split"] = r.split
        LR.append(x)
LR = pd.DataFrame(LR)
rows = []
for sp in ["train", "test"]:
    sub = LR[LR.split == sp]
    rows.append([sp, len(sub), sub.set_id.nunique(), fmt_q(sub.beats), fmt_q(sub.rms_rel), f"{sub.near_boundary.mean():.2f}", f"{(sub.rms_rel < 0.5).mean():.2f}"])
txt3 = ("### Przerwy ludzi ≥ 4 beaty\n\n" + md_table(rows, ["split", "przerw", "map", "długość [beat] p10/p50/p90", "RMS w przerwie / mediana utworu",
                                                         "≤ 4 takty od granicy sekcji", "RMS < 0,5 mediany"]))
# co algorytm gra w przerwach człowieka (test)
cnt = []
for x in LR[LR.split == "test"].itertuples():
    a = notes("algo", x.set_id)
    k = ((a[:, 0] > x.a + 50) & (a[:, 0] < x.b - 50)).sum()
    cnt.append(dict(set_id=x.set_id, beats=x.beats, algo_notes=int(k), per_beat=k / x.beats, rms=x.rms_rel))
C = pd.DataFrame(cnt)
txt3 += (f"\n\nW {len(C)} przerwach ≥ 4 beaty ludzi z testu ({C.set_id.nunique()} utworów) algorytm ma nuty w {int((C.algo_notes > 0).sum())}; "
         f"nut na beat przerwy p10/p50/p90: {fmt_q(C.per_beat)}.")
(RESULTS / "auxiliary.md").write_text(txt + "\n\n" + txt2 + "\n\n" + txt3)
print(txt3)
