# After the bar failed: was the comparison fair, and does separation help some songs? Exploratory, not a second bar.
# In mewbeat-ma: /scripts = the salience dir with feat/, /out = .mewbeat-debug, /listening = listening dir. Train songs only.
import os, sys, glob, json, pickle
import numpy as np
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
sys.path.insert(0, "/listening")
from common import load, rank_cols, f1_topk, songs_with, LV, WIN
from build_variants import near, pct, fit_base, BASE_FEATURES
from selection import select

FEAT = "/out/data/stems/_feat"
OUTFILE = "/out/data/stems/_followup.json"
METER = ["m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]
K_COLS = ["rel_os"] + METER
STEMS = ("drums", "bass", "other", "vocals", "guitar", "piano")
PITCHED = ("other", "vocals", "guitar", "piano")
NFOLD = 5
HD_PARTS = [(0, 20, "skrzypce"), (20, 22, "szybka sekwencja"), (22, 45, "melodia"), (45, 67, "sama gitara"),
            (67, 79, "gitara z melodia"), (79, 90, "gitara z dzwonkiem"), (90, 112, "melodia i flet")]


def oof(X, y, fold):
    p = np.zeros(len(y))
    for f in range(NFOLD):
        tr, te = fold != f, fold == f
        p[te] = LogisticRegression(C=1.0, max_iter=400).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return p


def windows(ss, sid, lv, scores, shares):
    """Each score (one per instrument, each with the meter) competes for the k human moments of every 8 s window."""
    rng = np.random.default_rng(11)
    tot = dict(k=0, K=0, best=0, floor=0, loudest=0)
    for i, s in enumerate(ss):
        hm, hidx, t = s["human"][lv], s["hidx"][lv], s["t"]
        at_song = sid == i
        win = (t // WIN).astype(int)
        need = np.bincount((hm // WIN).astype(int), minlength=win.max() + 1)
        pk = scores["K"][at_song]
        for w in np.unique(win):
            k = int(need[w]) if w < len(need) else 0
            at = np.where(win == w)[0]
            if k == 0:
                continue
            def tp(v):
                h = hidx[at[np.argsort(-v[at])[:k]]]
                return len(np.unique(h[h >= 0]))
            by = {st: tp(scores[st][at_song]) for st in STEMS}
            tot["k"] += k
            tot["K"] += tp(pk)
            tot["best"] += max(by.values())
            # The same search over the K score with noise tells how much the max of six gains by luck alone.
            tot["floor"] += max(tp(pk + 0.05 * rng.standard_normal(len(t))) for _ in STEMS)
            tot["loudest"] += by[max(PITCHED, key=lambda st: s["S"][at, s["Sn"].index(f"s_long_{st}")].mean())]
    return {k: round(v / tot["k"], 4) for k, v in tot.items() if k != "k"}


def hopes_and_dreams(model):
    r = pickle.load(open("/scripts/feat/hd.pkl", "rb"))
    f = pickle.load(open(f"{FEAT}/hd.pkl", "rb"))
    Xr = rank_cols(r["X"])
    base = model.predict_proba(Xr[:, [r["names"].index(n) for n in BASE_FEATURES]])[:, 1]
    t = r["t"]
    beats = r["dur"] * r["bpm"] / 60
    chosen = np.array(select(list(t), list(base), [False] * len(t), [True] * len(t), int(round(1.485 * beats))))
    pt = t[chosen]
    lead = {s: near(pt, f["notes"][s], 40) for s in PITCHED}
    drums = pct(f["X"][:, f["names"].index("s_rel_drums")])[chosen] >= .8
    out = []
    for a, b, name in HD_PARTS:
        m = (pt >= a * 1000) & (pt < b * 1000)
        n = int(m.sum())
        any_note = np.any([lead[s][m] for s in PITCHED], axis=0)
        all_notes = sum(int(((f["notes"][s] >= a * 1000) & (f["notes"][s] < b * 1000)).sum()) for s in PITCHED)
        out.append({"part": name, "chosen": n, "on_pitched_note": round(float(any_note.mean()), 3) if n else None,
                    "on_strong_drum": round(float(drums[m].mean()), 3) if n else None,
                    "drum_only": round(float((drums[m] & ~any_note).mean()), 3) if n else None, "pitched_notes": all_notes})
    return out


def main():
    have = {os.path.basename(p)[:-4] for p in glob.glob(f"{FEAT}/*.pkl")} - {"hd"}
    songs = load(have)
    for s in songs:
        f = pickle.load(open(f"{FEAT}/{s['id']}.pkl", "rb"))
        s["S"], s["Sn"], s["Sr"] = f["X"], f["names"], rank_cols(f["X"])
        s["drum_share"] = float(np.mean(f["share_1hz"]["drums"]))
    rng = np.random.default_rng(0)
    fold_of = {s["id"]: int(v) for s, v in zip(songs, rng.permutation(len(songs)) % NFOLD)}
    R = {"levels": {}}
    for lv in LV:
        ss = songs_with(songs, lv)
        col = lambda n: np.concatenate([s["Xr"][:, s["names"].index(n)] for s in ss])
        Mt = np.stack([col(n) for n in METER], 1)
        St = np.concatenate([s["Sr"] for s in ss])
        y = np.concatenate([s["label"][lv] for s in ss])
        sid = np.concatenate([np.full(len(s["t"]), i) for i, s in enumerate(ss)])
        fold = np.array([fold_of[s["id"]] for s in ss])[sid]
        Sn = ss[0]["Sn"]
        scores = {"K": oof(np.column_stack([col("rel_os"), Mt]), y, fold)}
        for st in STEMS:
            scores[st] = oof(np.column_stack([St[:, Sn.index(f"s_rel_{st}")], Mt]), y, fold)
        all_s = oof(np.column_stack([col("rel_os"), Mt, St]), y, fold)
        f1 = lambda p: np.array([f1_topk(s["t"], p[sid == i], s["hidx"][lv], s["human"][lv], seed=i) for i, s in enumerate(ss)])
        fk, fs = f1(scores["K"]), f1(all_s)
        d = fs - fk
        shares = np.array([s["drum_share"] for s in ss])
        lo, hi = np.quantile(shares, [1 / 3, 2 / 3])
        groups = {"malo perkusji": shares <= lo, "srodek": (shares > lo) & (shares <= hi), "duzo perkusji": shares > hi}
        R["levels"][lv] = {
            "stem_plus_meter_alone": {st: round(float(np.nanmedian(f1(scores[st]))), 4) for st in STEMS},
            "K": round(float(np.nanmedian(fk)), 4),
            "windows": windows(ss, sid, lv, scores, None),
            "songs_gain": {"over_.02": int((d >= .02).sum()), "under_-.02": int((d <= -.02).sum()), "n": len(d)},
            "by_drums": {g: {"songs": int(m.sum()), "delta_f1": round(float(np.nanmean(d[m])), 4), "drum_share": round(float(shares[m].mean()), 3)} for g, m in groups.items()},
            "named": {s["id"]: round(float(d[i]), 4) for i, s in enumerate(ss) if s["id"] in ("476691", "1374931", "2045473")},
        }
        print(lv, json.dumps(R["levels"][lv]), flush=True)
    R["hd_parts"] = hopes_and_dreams(fit_base())
    print(json.dumps(R["hd_parts"], ensure_ascii=False), flush=True)
    json.dump(R, open(OUTFILE, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
