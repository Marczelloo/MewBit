# Do holds follow the sounds that last? People against v26, plus what a detector without separation could see. Train songs only.
# In mewbeat-ma: /scripts = the salience dir with feat/, /out = .mewbeat-debug, /repo = the repository, read-only, /listening = listening dir.
import os, sys, csv, glob, json, pickle, argparse
import numpy as np
from scipy.stats import rankdata
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
sys.path.insert(0, "/listening")
from common import auc_fast, LV
from build_variants import near, pct

DATA = "/out/data"
STEM_FEAT = f"{DATA}/stems/_feat"
SUST = f"{DATA}/stems/_sust"
OUTFILE = f"{SUST}/_measure.json"
CHARTS = "v26"
STEMS = ("bass", "other", "vocals", "guitar", "piano")
PITCHED = ("other", "vocals", "guitar", "piano")
MIN_SHARE = .1      # an instrument under this share of the energy is not what the player hears
LONG_SHARE = .2     # the same for the list of long sounds
LONG_BEATS = 1.5
SOUNDING = .7       # a hold is on a lasting sound when one sound covers this much of it
HEAD_MS = 60
TONAL_MIN_CONF = .8
PLACEBO_DRAWS = 5
KEEP_RATIO = 10 ** (-9 / 10)  # no quarter of the hold more than 9 dB under its loudest quarter
HD_PARTS = [(0, 20, "skrzypce"), (20, 22, "szybka sekwencja"), (22, 45, "melodia"), (45, 67, "sama gitara"),
            (67, 79, "gitara z melodia"), (79, 90, "gitara z dzwonkiem"), (90, 112, "melodia i flet")]
CHEAP = ["mix_len", "keep_db", "chroma_stab", "flux_after", "lead_len", "bass_len", "on_beat"]
ORACLE = ["stem_len", "vocal_len"]


def train_ids():
    with open("/repo/mapping-analysis/shared/corpus.csv", encoding="utf8") as f:
        ids = {r["set_id"] for r in csv.DictReader(f) if r["split"] == "train"}
    return sorted(ids & {os.path.basename(p)[:-4] for p in glob.glob(f"{SUST}/*.pkl")})


def chart(path, human):
    if not os.path.exists(path):
        return None
    raw = json.load(open(path))
    if human:
        rows = [(n[0], n[1], n[2] if n[2] is not None else np.nan) for n in raw]
    else:
        rows = [(n["t"], n["lane"], n["t"] + n["len"] if n.get("len") else np.nan) for n in raw]
    a = np.array(sorted(rows), dtype=np.float64).reshape(-1, 3)
    return {"t": a[:, 0], "lane": a[:, 1], "end": a[:, 2]}


def moments(t):
    return t[np.r_[True, np.diff(t) > 5]] if len(t) else t


def merge_legato(notes, max_gap=60, max_range=1):
    """legato.js on the lead line."""
    out, run = [], []
    lo = hi = end = 0
    for n in sorted(notes, key=lambda n: n["t"]):
        if run and n["t"] - end <= max_gap and max(hi, n["pitch"]) - min(lo, n["pitch"]) <= max_range:
            pass
        else:
            if run:
                out.append(merged(run))
            run, lo, hi, end = [], n["pitch"], n["pitch"], 0
        run.append(n)
        lo, hi = min(lo, n["pitch"]), max(hi, n["pitch"])
        end = max(end, n["t"] + (n.get("len") or 0))
    if run:
        out.append(merged(run))
    return out


def merged(run):
    e = max(n["t"] + (n.get("len") or 0) for n in run)
    return {"t": run[0]["t"], "len": e - run[0]["t"], "conf": float(np.mean([n.get("conf") or 0 for n in run]))}


def tonal(notes):
    """[t, len] of what addSustainHolds may read: the confident notes of a line."""
    a = [(n["t"], n.get("len") or 0) for n in notes if (n.get("conf") or 0) >= TONAL_MIN_CONF]
    return np.array(a, dtype=np.float64).reshape(-1, 2)


def best_cover(a, b, seg):
    """The sound that covers most of [a, b]: (share of the range, its start, its end)."""
    if len(seg) == 0 or b <= a:
        return 0.0, np.nan, np.nan
    ov = np.minimum(b, seg[:, 0] + seg[:, 1]) - np.maximum(a, seg[:, 0])
    i = int(np.argmax(ov))
    return max(float(ov[i] / (b - a)), 0.0), float(seg[i, 0]), float(seg[i, 0] + seg[i, 1])


def len_at(t, seg, tol):
    """The longest sound starting within tol of each moment, 0 when none does."""
    out = np.zeros(len(t))
    if len(seg) == 0:
        return out
    for i, x in enumerate(t):
        m = np.abs(seg[:, 0] - x) <= tol
        if m.any():
            out[i] = seg[m, 1].max()
    return out


def window(series, t, a_ms, b_ms, step, shift):
    i = np.clip(np.round((t + a_ms + shift) / step).astype(int), 0, series.shape[-1] - 1)
    j = np.clip(np.round((t + b_ms + shift) / step).astype(int) + 1, 1, series.shape[-1])
    j = np.maximum(j, i + 1)
    return i, j


def keeps_sounding(a, b, x):
    """A looser test than one steady pitch: some melodic instrument stays loud through the range and is a real part of the sound."""
    step, shift = x["slow_ms"], x["shift"]
    edges = np.linspace(a, b, 5)
    i = np.clip(np.round((edges + shift) / step).astype(int), 0, min(len(v) for v in x["stem_energy"].values()) - 1)
    if i[-1] - i[0] < 4:
        return False
    total = sum(v[i[0]:i[-1]].mean() for v in x["stem_energy"].values()) + 1e-12
    for s in STEMS:
        e = x["stem_energy"][s]
        parts = [e[i[k]:max(i[k + 1], i[k] + 1)].mean() for k in range(4)]
        if e[i[0]:i[-1]].mean() / total >= MIN_SHARE and min(parts) >= max(parts) * KEEP_RATIO:
            return True
    return False


def hold_stats(c, beat, sounds, mix, rng, x):
    held = np.where(~np.isnan(c["end"]))[0]
    tap_t = c["t"][np.isnan(c["end"])]
    ms = moments(c["t"])
    out = {"holds": len(held), "notes": len(c["t"]), "share": len(held) / max(len(c["t"]), 1)}
    if len(held) < 3:
        return out
    lens, under, other_hand, rel_next, covered, cov_mix, head, ends, placebo = [], [], [], [], [], [], [], [], []
    kept, kept_placebo, long_cov, long_placebo, long_kept, long_kept_placebo = [], [], [], [], [], []
    by_stem = {s: [] for s in STEMS}
    all_seg = np.concatenate([sounds[s] for s in STEMS])
    for i in held:
        a, b, lane = c["t"][i], c["end"][i], c["lane"][i]
        lens.append((b - a) / beat)
        inside = (c["t"] > a + 10) & (c["t"] < b - 10)
        under.append(int(inside.sum()))
        if inside.any():
            other_hand.append(float(((c["lane"][inside] < 2) != (lane < 2)).mean()))
        nxt = ms[ms > a + 10]
        rel_next.append(len(nxt) > 0 and abs(nxt[0] - b) <= 40)
        cov, st, en = best_cover(a, b, all_seg)
        covered.append(cov >= SOUNDING)
        cov_mix.append(best_cover(a, b, mix)[0] >= SOUNDING)
        head.append(abs(st - a) <= HEAD_MS and cov >= SOUNDING)
        if cov >= SOUNDING:
            ends.append(abs(en - b) <= max(60, beat / 4))
        for s in STEMS:
            by_stem[s].append(best_cover(a, b, sounds[s])[0] >= SOUNDING)
        keep = keeps_sounding(a, b, x)
        kept.append(keep)
        is_long = b - a >= LONG_BEATS * beat
        if is_long:
            long_cov.append(cov >= SOUNDING)
            long_kept.append(keep)
        if len(tap_t):
            drawn = rng.choice(tap_t, PLACEBO_DRAWS)
            p_cov = np.mean([best_cover(d, d + b - a, all_seg)[0] >= SOUNDING for d in drawn])
            p_keep = np.mean([keeps_sounding(d, d + b - a, x) for d in drawn])
            placebo.append(p_cov)
            kept_placebo.append(p_keep)
            if is_long:
                long_placebo.append(p_cov)
                long_kept_placebo.append(p_keep)
    under = np.array(under)
    avg = lambda v: float(np.mean(v)) if v else None
    out.update(kept=avg(kept), kept_placebo=avg(kept_placebo), long_on_sound=avg(long_cov), long_placebo=avg(long_placebo),
               long_kept=avg(long_kept), long_kept_placebo=avg(long_kept_placebo))
    out.update(len_beats=float(np.median(lens)), long_share=float(np.mean(np.array(lens) >= 1.5)), with_under=float((under > 0).mean()),
               under_per_hold=float(under.mean()), under_other_hand=float(np.mean(other_hand)) if other_hand else None,
               release_on_next=float(np.mean(rel_next)), on_sound=float(np.mean(covered)), on_sound_mix=float(np.mean(cov_mix)),
               head_on_start=float(np.mean(head)), end_on_end=float(np.mean(ends)) if ends else None,
               placebo=float(np.mean(placebo)) if placebo else None, by_stem={s: float(np.mean(v)) for s, v in by_stem.items()})
    return out


def long_sounds(sounds, beat):
    """[t, len, stem index] of every long sound someone would hear."""
    rows = []
    for k, s in enumerate(STEMS):
        seg = sounds[s]
        m = (seg[:, 1] >= LONG_BEATS * beat) & (seg[:, 4] >= LONG_SHARE)
        rows += [(x[0], x[1], k) for x in seg[m]]
    return np.array(sorted(rows), dtype=np.float64).reshape(-1, 3)


def sound_coverage(ls, c, rng):
    """How many long sounds the chart honours with a hold, and how many with a plain note it could have held."""
    held = np.where(~np.isnan(c["end"]))[0]
    heads, ends = c["t"][held], c["end"][held]
    ms = moments(c["t"])
    def honoured(hh, ee):
        n = 0
        for t, l, _ in ls:
            ov = np.minimum(t + l, ee) - np.maximum(t, hh)
            n += int(len(ov) > 0 and ((np.abs(hh - t) <= 80).any() or (ov >= .5 * l).any()))
        return n
    off = rng.uniform(0, max(ms.max(), 1), PLACEBO_DRAWS) if len(ms) else []
    span = max(ms.max(), 1) if len(ms) else 1
    placebo = np.mean([honoured((heads + o) % span, (heads + o) % span + (ends - heads)) for o in off]) if len(off) else 0
    return {"n": len(ls), "honoured": honoured(heads, ends), "placebo": float(placebo),
            "note_at_start": int(sum(bool(len(ms)) and np.abs(ms - t).min() <= 40 for t, _, _ in ls))}


def detector_recall(ls, lead, bass, mix, beat):
    """A long sound is seen when a detector has a note covering at least half of it."""
    def seen(seg):
        n = 0
        for t, l, _ in ls:
            if len(seg):
                n += int((np.minimum(t + l, seg[:, 0] + seg[:, 1]) - np.maximum(t, seg[:, 0]) >= .5 * l).any())
        return n
    return {"lead_bass": seen(np.concatenate([lead, bass])), "lead": seen(lead), "bass": seen(bass),
            "mix": seen(mix[mix[:, 1] >= beat] if len(mix) else mix)}


def moment_rows(c, r, x, beat, sounds, lead, bass):
    """One row per moment of a human chart: can the sound tell a hold head from a plain note?"""
    ms = moments(c["t"])
    if len(ms) < 20:
        return None
    head_t = c["t"][~np.isnan(c["end"])]
    y = np.array([len(head_t) > 0 and np.abs(head_t - t).min() <= 5 for t in ms])
    step, shift = x["slow_ms"], x["shift"]
    e, chroma, flux = x["h_energy"], x["chroma"], x["h_flux"]
    a0, a1 = window(e, ms, 0, beat / 4, step, shift)
    b0, b1 = window(e, ms, beat / 2, beat, step, shift)
    f0, f1 = window(flux, ms, 60, beat, step, shift)
    c0, c1 = window(chroma, ms, 0, beat / 4, step, shift)
    d0, d1 = window(chroma, ms, 3 * beat / 4, beat, step, shift)
    keep, stab, after = [], [], []
    for i in range(len(ms)):
        keep.append(10 * np.log10((e[b0[i]:b1[i]].mean() + 1e-9) / (e[a0[i]:a1[i]].mean() + 1e-9)))
        after.append(flux[f0[i]:f1[i]].mean())
        p, q = chroma[:, c0[i]:c1[i]].mean(1), chroma[:, d0[i]:d1[i]].mean(1)
        stab.append(float(p @ q / (np.linalg.norm(p) * np.linalg.norm(q) + 1e-9)))
    j = np.clip(np.searchsorted(r["t"], ms), 1, len(r["t"]) - 1)
    j = np.where(np.abs(r["t"][j - 1] - ms) <= np.abs(r["t"][j] - ms), j - 1, j)
    on_beat = r["X"][j, r["names"].index("m_beat")] * (np.abs(r["t"][j] - ms) <= 35)
    gap = np.r_[np.diff(ms), beat * 4] / beat
    pitched = np.concatenate([sounds[s][sounds[s][:, 4] >= MIN_SHARE] for s in STEMS])
    vocal = sounds["vocals"][sounds["vocals"][:, 4] >= MIN_SHARE]
    rows = {"mix_len": len_at(ms, x["mix"], HEAD_MS) / beat, "keep_db": np.array(keep), "chroma_stab": np.array(stab),
            "flux_after": -np.array(after), "lead_len": len_at(ms, lead, 40) / beat, "bass_len": len_at(ms, bass, 40) / beat,
            "on_beat": on_beat, "gap": gap, "stem_len": len_at(ms, pitched, HEAD_MS) / beat, "vocal_len": len_at(ms, vocal, HEAD_MS) / beat}
    return {"y": y, **rows}


def detector_table(rows):
    """Per-song AUC of each signal, and of models on the rank of the signals validated by song."""
    keys = CHEAP + ["gap"] + ORACLE
    res = {"holds_per_song": float(np.median([d["y"].mean() for d in rows.values()]))}
    good = {s: d for s, d in rows.items() if d["y"].sum() >= 5}
    res["single"] = {k: round(float(np.nanmedian([auc_fast(d[k], d["y"]) for d in good.values()])), 3) for k in keys}
    ids = sorted(good)
    fold = {s: i % 5 for i, s in enumerate(np.random.default_rng(3).permutation(ids))}
    rk = {s: {k: rankdata(d[k]) / len(d[k]) for k in keys} for s, d in good.items()}
    def model(cols):
        aucs, top = [], []
        for f in range(5):
            tr = [s for s in ids if fold[s] != f]
            X = np.concatenate([np.column_stack([rk[s][k] for k in cols]) for s in tr])
            y = np.concatenate([good[s]["y"] for s in tr])
            m = LogisticRegression(C=1.0, max_iter=400, class_weight="balanced").fit(X, y)
            for s in ids:
                if fold[s] == f:
                    p = m.predict_proba(np.column_stack([rk[s][k] for k in cols]))[:, 1]
                    aucs.append(auc_fast(p, good[s]["y"]))
                    k = int(good[s]["y"].sum())
                    top.append(good[s]["y"][np.argsort(-p)[:k]].mean())
        return {"auc": round(float(np.nanmedian(aucs)), 3), "precision_at_k": round(float(np.mean(top)), 3)}
    res["models"] = {"przerwa": model(["gap"]), "tani": model(CHEAP), "tani+przerwa": model(CHEAP + ["gap"]),
                     "tani+przerwa+sciezki": model(CHEAP + ["gap"] + ORACLE)}
    res["songs"] = len(good)
    res["hears_long_sound"] = hears_long_sound(rows)
    return res


def hears_long_sound(rows):
    """Can the mix alone tell a moment that starts a long sound, taking the separated instruments as the answer? Validated by song."""
    target = {s: d["stem_len"] >= LONG_BEATS for s, d in rows.items()}
    good = {s: d for s, d in rows.items() if 5 <= target[s].sum() < len(target[s]) - 5}
    ids = sorted(good)
    if len(ids) < 10:
        return {"songs": len(ids)}
    fold = {s: i % 5 for i, s in enumerate(np.random.default_rng(4).permutation(ids))}
    rk = {s: np.column_stack([rankdata(d[k]) / len(d[k]) for k in CHEAP]) for s, d in good.items()}
    aucs, top = [], []
    for f in range(5):
        tr = [s for s in ids if fold[s] != f]
        m = LogisticRegression(C=1.0, max_iter=400, class_weight="balanced").fit(np.concatenate([rk[s] for s in tr]), np.concatenate([target[s] for s in tr]))
        for s in ids:
            if fold[s] == f:
                p = m.predict_proba(rk[s])[:, 1]
                aucs.append(auc_fast(p, target[s]))
                top.append(target[s][np.argsort(-p)[:int(target[s].sum())]].mean())
    return {"songs": len(ids), "base_rate": round(float(np.mean([target[s].mean() for s in ids])), 3),
            "single": {k: round(float(np.nanmedian([auc_fast(good[s][k], target[s]) for s in ids])), 3) for k in CHEAP},
            "auc": round(float(np.nanmedian(aucs)), 3), "precision_at_k": round(float(np.mean(top)), 3)}


def drum_control(ms, r, f):
    """Share of chart moments on a pitched note, and on a strong drum hit with no pitched note nearby."""
    if len(ms) == 0:
        return None
    t = r["t"]
    drums = pct(f["X"][:, f["names"].index("s_rel_drums")]) >= .8
    j = np.clip(np.searchsorted(t, ms), 1, len(t) - 1)
    j = np.where(np.abs(t[j - 1] - ms) <= np.abs(t[j] - ms), j - 1, j)
    strong = drums[j] & (np.abs(t[j] - ms) <= 40)
    note = np.any([near(ms, f["notes"][s], 40) for s in PITCHED], axis=0)
    return {"on_note": float(note.mean()), "drum_only": float((strong & ~note).mean()), "strong_drum": float(strong.mean()), "mask": strong & ~note, "note": note}


def mean_of(rows, key):
    v = [x[key] for x in rows if x.get(key) is not None]
    return round(float(np.mean(v)), 3) if v else None


def stack(sounds):
    return {s: sounds[s].astype(np.float64) for s in STEMS}


def load_song(sid):
    r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
    x = pickle.load(open(f"{SUST}/{sid}.pkl", "rb"))
    f = pickle.load(open(f"{STEM_FEAT}/{sid}.pkl", "rb"))
    path = "/repo/.mewbeat-preview/toby-fox-hopes-and-dreams-undertale.json" if sid == "hd" else f"{DATA}/features/{sid}.json"
    feat = json.load(open(path))
    feat = feat.get("features", feat)
    return r, x, f, tonal(merge_legato(feat.get("lead") or [])), tonal(feat.get("bass") or [])


def main():
    global CHARTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--charts", default="v26", help="the snapshot under /out/data/charts to measure (its Hopes and Dreams charts are <charts>-hd)")
    CHARTS = ap.parse_args().charts
    ids = train_ids()
    print("songs", len(ids), flush=True)
    rng = np.random.default_rng(5)
    stats = {lv: {"human": [], "v26": []} for lv in LV}
    cover = {lv: {"human": [], "v26": []} for lv in LV}
    drum = {lv: {"human": [], "v26": []} for lv in LV}
    rows = {lv: {} for lv in LV}
    recall, per_min = [], []
    for n, sid in enumerate(ids):
        r, x, f, lead, bass = load_song(sid)
        beat = 60000.0 / r["bpm"]
        sounds = stack(x["stems"])
        mix = x["mix"].astype(np.float64)
        sounds_share = {s: sounds[s][sounds[s][:, 4] >= MIN_SHARE] for s in STEMS}
        ls = long_sounds(sounds, beat)
        recall.append({**detector_recall(ls, lead, bass, mix, beat), "n": len(ls), "vocal": int((ls[:, 2] == STEMS.index("vocals")).sum()) if len(ls) else 0})
        per_min.append(len(ls) / (r["dur"] / 60000 if r["dur"] > 1000 else r["dur"] / 60))
        for lv in LV:
            for src, human in (("human", True), ("v26", False)):
                base = f"{DATA}/human/{lv}" if human else f"{DATA}/charts/{CHARTS}/{lv}"
                c = chart(f"{base}/{sid}.json", human)
                if c is None or len(c["t"]) == 0:
                    continue
                stats[lv][src].append(hold_stats(c, beat, sounds_share, mix, rng, x))
                cover[lv][src].append(sound_coverage(ls, c, rng))
                d = drum_control(moments(c["t"]), r, f)
                drum[lv][src].append({k: v for k, v in d.items() if k not in ("mask", "note")})
                if human:
                    m = moment_rows(c, r, x, beat, sounds, lead, bass)
                    if m is not None:
                        rows[lv][sid] = m
        print(n, sid, len(ls), flush=True)
    R = {"songs": len(ids), "long_sounds_per_min": round(float(np.median(per_min)), 2), "levels": {}}
    tot = {k: sum(x[k] for x in recall) for k in recall[0]}
    R["detector_recall"] = {k: round(tot[k] / max(tot["n"], 1), 3) for k in ("lead_bass", "lead", "bass", "mix")}
    R["long_sounds_total"], R["long_sounds_vocal"] = tot["n"], tot["vocal"]
    for lv in LV:
        L = {}
        for src in ("human", "v26"):
            s = stats[lv][src]
            usable = [x for x in s if x.get("len_beats") is not None]
            L[src] = {k: mean_of(usable if k != "share" else s, k) for k in
                      ("share", "len_beats", "long_share", "with_under", "under_per_hold", "under_other_hand", "release_on_next",
                       "on_sound", "on_sound_mix", "placebo", "head_on_start", "end_on_end", "kept", "kept_placebo",
                       "long_on_sound", "long_placebo", "long_kept", "long_kept_placebo")}
            L[src]["songs"] = len(usable)
            L[src]["by_stem"] = {st: round(float(np.mean([x["by_stem"][st] for x in usable])), 3) for st in STEMS}
            cv = cover[lv][src]
            nn = max(sum(x["n"] for x in cv), 1)
            L[src]["long_sounds_held"] = round(sum(x["honoured"] for x in cv) / nn, 3)
            L[src]["long_sounds_placebo"] = round(sum(x["placebo"] for x in cv) / nn, 3)
            L[src]["long_sounds_note_at_start"] = round(sum(x["note_at_start"] for x in cv) / nn, 3)
            L[src]["drum"] = {k: mean_of(drum[lv][src], k) for k in ("on_note", "drum_only", "strong_drum")}
        L["detector"] = detector_table(rows[lv])
        R["levels"][lv] = L
        print(lv, json.dumps(L, ensure_ascii=False), flush=True)
    R["recall"] = R["detector_recall"]
    print(json.dumps({k: R[k] for k in ("songs", "long_sounds_per_min", "detector_recall", "long_sounds_total", "long_sounds_vocal")}), flush=True)
    R["hd"] = hopes_and_dreams()
    print(json.dumps(R["hd"], ensure_ascii=False), flush=True)
    json.dump(R, open(OUTFILE, "w"), indent=1, ensure_ascii=False)


def hopes_and_dreams():
    r, x, f, lead, bass = load_song("hd")
    beat = 60000.0 / r["bpm"]
    sounds = stack(x["stems"])
    ls = long_sounds(sounds, beat)
    charts = {lv: chart(f"{DATA}/charts/{CHARTS}-hd/{lv}.json", False) for lv in LV}
    out = {"recall": detector_recall(ls, lead, bass, x["mix"].astype(np.float64), beat), "long_sounds": len(ls), "parts": []}
    for a, b, name in HD_PARTS:
        m = (ls[:, 0] >= a * 1000) & (ls[:, 0] < b * 1000)
        part = {"part": name, "long_sounds": int(m.sum()), "by_stem": {s: int((ls[m, 2] == k).sum()) for k, s in enumerate(STEMS)}}
        for lv, c in charts.items():
            inside = (c["t"] >= a * 1000) & (c["t"] < b * 1000)
            ms = moments(c["t"][inside])
            d = drum_control(ms, r, f)
            sub = {k: v[inside] for k, v in c.items()}
            cv = sound_coverage(ls[m], sub, np.random.default_rng(1))
            part[lv] = {"notes": int(inside.sum()), "holds": int((~np.isnan(sub["end"])).sum()), "held_sounds": cv["honoured"],
                        "on_note": round(d["on_note"], 3) if d else None, "drum_only": round(d["drum_only"], 3) if d else None}
        out["parts"].append(part)
    order = np.argsort(-ls[:, 1])[:20]
    out["longest"] = [{"t": round(ls[i, 0] / 1000, 2), "beats": round(ls[i, 1] / beat, 1), "stem": STEMS[int(ls[i, 2])]} for i in sorted(order)]
    return out


if __name__ == "__main__":
    main()
