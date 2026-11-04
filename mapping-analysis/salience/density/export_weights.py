# Weights of K for the Java plugin / the generator: one logistic regression per level (E/N/H), fitted on all 80 train songs.
# Two sets, same format:
#   k_weights.json      strength column = rel_os. The decision of A (rel_proxy.log): no Features v4 proxy replaces rel_os.
#   k_weights_raw.json  strength column = raw_strength (largest source strength in the candidate cluster), the best Features v4 proxy.
#                       Not the decision; the user may choose it (rel_proxy_select.log compares the two when selecting notes).
# Both take the meter on the generator's beat grid (ctx.timing). Writes only /density/k_weights*.json. Train songs only.
# Each file carries definitions of the inputs, a toy rank example, a toy meter example, and a test vector (candidates of one train
# song with the inputs and the expected scores) so that a port can be pinned to it.
import sys, json
import numpy as np
sys.path.insert(0, "/density")
from dcommon import *  # noqa: F401,F403
from rel_proxy import proxies  # noqa: E402

DEFS = {
    "rel_os": ("librosa.onset.onset_strength (mel spectrogram, 22050 Hz, hop 256, n_fft 2048) divided by its uniform mean over 2 s "
               "(172 frames, edges repeated) plus 1e-6; then a maximum filter over 5 frames; sampled at the candidate time plus a per-song "
               "mel shift (extract.py build). Per-song mel shift: z-score the plain onset-strength series (before the 2 s division); for each lag L in "
               "-8..8 frames take the mean of that z-scored series at frame round(t_c / 11.61 ms) + L over all candidates c of the song "
               "(frame index clipped to the series); the shift is 11.61 ms times the L with the highest mean (ties: the first, i.e. the smallest L). "
               "Frame length = 1000 * 256 / 22050 = 11.61 ms. The plugin has to supply it; Features v4 does not carry it."),
    "raw_strength": ("largest onset strength 's' among the Features v4 onsets of the candidate cluster, over the sources low, lowmid, "
                     "highmid, high, drums, bass, lead (extract.candidates, P.max(axis=1)). Not normalised. Needs nothing beyond Features v4."),
    "m_beat": "1 if the candidate lies within 0.07 of a beat period of a grid beat, else 0.",
    "m_half": "1 if within 0.07 of the half-beat position (and m_beat is 0), else 0.",
    "m_quarter": "1 if within 0.07 of a quarter-beat position (0.25 or 0.75; and m_beat, m_half are 0), else 0.",
    "m_other": "1 if none of m_beat, m_half, m_quarter, else 0.",
    "m_down": ("1 if m_beat is 1 and the nearer of the two surrounding beats lies within 2 ms of a downbeat of the grid, else 0. "
               "0 everywhere when the grid has no downbeats."),
    "d_grid": ("distance to the nearest of the beat, half-beat and quarter-beat positions, as a fraction of the beat period "
               "(u = position in the beat in [0,1); min(u, 1-u, |u-0.5|, |u-0.25|, |u-0.75|))."),
    "meter": ("Position in the beat: i = last grid beat at or before the candidate (clipped to the second-to-last beat), "
              "u = (t - beats[i]) / (beats[i+1] - beats[i]) mod 1. Grid = ctx.timing.beats / .downbeats of the generator."),
    "no_grid": ("When the generator has no snapped grid (ctx.timing.snapped false) or fewer than 3 beats: m_other = 1 and every other meter "
                "column (m_beat, m_half, m_quarter, m_down, d_grid) = 0 for every candidate. 1 of the 80 train songs has no grid."),
}
RANK = ("Every column is turned into a within-song rank before scoring. Columns with more than 2 distinct values in the song: average rank "
        "(ties get the mean of their ranks, 1-based) divided by the number of candidates n of that song, so the values lie in (0, 1]. "
        "Columns with at most 2 distinct values (the binary meter flags, or a constant column) stay raw. Same as common.rank_cols; "
        "scipy.stats.rankdata(method='average') / n. The ranks are float32 in the fit; a port may use float64.")
TOY_RANK = {"raw": [3, 1, 3, 2, 5], "ranked": [0.7, 0.2, 0.7, 0.4, 1.0], "binary_raw": [0, 1, 1, 0, 0], "binary_ranked": [0, 1, 1, 0, 0],
            "constant_raw": [0, 0, 0, 0, 0], "constant_ranked": [0, 0, 0, 0, 0]}


def toy_meter():
    beats, downbeats = [0, 500, 1000, 1500, 2000, 2500], [0, 2000]
    ts = [0, 125, 250, 375, 500, 560, 1010, 700, 1750, 2000]
    m = meter(np.asarray(ts, float), beats, downbeats, 0)
    nog = meter(np.asarray(ts, float), [], [], 0)
    cols = ["m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]
    f = lambda mm: [{"t_ms": t, **{c: round(float(mm[c][i]), 6) for c in cols}} for i, t in enumerate(ts)]
    return {"beats_ms": beats, "downbeats_ms": downbeats, "candidates": f(m), "no_grid_candidates": f(nog)}


def fit_set(ss, names, strength):
    colfn = (lambda s: s["X"][:, names.index("rel_os")]) if strength == "rel_os" else (lambda s: s["px"]["raw_strength"])
    feats = [strength] + K_COLS[1:]
    out = {"levels": {}}
    mats = {}
    for s in ss:
        mats[s["id"]] = rank_cols(np.stack([colfn(s)] + [s["gm"][c] for c in K_COLS[1:]], 1))
    for lv in LV:
        sl = [s for s in ss if lv in s["label"]]
        X = np.concatenate([mats[s["id"]] for s in sl])
        y = np.concatenate([s["label"][lv] for s in sl])
        m = LogisticRegression(C=1.0, max_iter=400).fit(X, y)
        out["levels"][lv] = {"songs": len(sl), "skipped_without_level": len(ss) - len(sl), "candidates": int(len(y)), "positive_rate": round(float(y.mean()), 4),
                             "coef": [round(float(c), 6) for c in m.coef_[0]], "intercept": round(float(m.intercept_[0]), 6)}
        print(strength, lv, out["levels"][lv], flush=True)
    # test vector: one train song with a grid and all three levels
    s = next(s for s in ss if s["ph"]["timing"]["snapped"] and all(lv in s["label"] for lv in LV))
    M = mats[s["id"]]
    raw = np.stack([colfn(s)] + [s["gm"][c] for c in K_COLS[1:]], 1)
    n = len(raw)
    pick = []
    for cond in (lambda i: raw[i, 5] == 1, lambda i: raw[i, 1] == 1 and raw[i, 5] == 0, lambda i: raw[i, 2] == 1, lambda i: raw[i, 3] == 1, lambda i: raw[i, 4] == 1):
        pick.append(next(i for i in range(200, n) if cond(i) and i not in pick))
    pick.append(int(np.argmax(raw[:, 0])))
    pick = sorted(set(pick))
    cands = []
    for i in pick:
        x = [round(float(v), 6) for v in M[i]]
        sc = {lv: round(out["levels"][lv]["intercept"] + float(np.dot(out["levels"][lv]["coef"], x)), 6) for lv in LV}
        cands.append({"index": int(i), "t_ms": float(s["t"][i]), "raw": [round(float(v), 6) for v in raw[i]], "ranked": x, "score": sc,
                      "probability": {lv: round(float(1 / (1 + np.exp(-sc[lv]))), 6) for lv in LV}})
    out["test_vector"] = {"song": s["id"], "n_candidates": int(n), "columns": feats,
                          "note": ("raw = the column values before ranking, in 'features' order; ranked = the values the model sees (rank "
                                   "percentiles within this song of all n_candidates candidates, binary flags raw); score = intercept + coef . ranked "
                                   "from the rounded coefficients and rounded ranked values listed here, tolerance 1e-5."),
                          "candidates": cands}
    return out, feats


def main():
    ss = songs_train()
    names = ss[0]["names"]
    for s in ss:
        s["gm"] = gen_meter(s)
        s["px"] = proxies(s)
    variants = {
        "rel_os": ("k_weights.json", "rel_os + meter on the generator grid (ctx.timing); chosen because no Features v4 proxy was within -.01 AUC of rel_os (rel_proxy.log)"),
        "raw_strength": ("k_weights_raw.json", "raw_strength + meter on the generator grid (ctx.timing); NOT the committed decision (A keeps rel_os); the best Features v4 proxy, "
                         "AUC lower than rel_os by .034/.042/.047 (E/N/H, rel_proxy.log); how it compares when notes are picked by count: rel_proxy_select.log"),
    }
    toy = toy_meter()
    for strength, (fn, variant) in variants.items():
        fit, feats = fit_set(ss, names, strength)
        out = {"variant": variant, "features": feats,
               "model": "sklearn LogisticRegression(C=1, max_iter=400); score = intercept + sum(coef[i] * x[i]); probability = 1 / (1 + exp(-score)); rank candidates by score",
               "inputs": {strength: DEFS[strength], **{k: DEFS[k] for k in ("m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid", "meter", "no_grid")}},
               "rank": RANK, "rank_example": TOY_RANK, "meter_example": toy,
               "candidates": "30 ms clusters of Features v4 onsets (extract.candidates: an onset joins a cluster while it lies within 30 ms of the cluster's first onset; "
                             "candidate time = the strongest onset of the cluster); label = a human note of that level within 35 ms",
               "train_songs": len(ss), **fit}
        json.dump(out, open("/density/" + fn, "w"), indent=1)
        print("wrote", fn, flush=True)


if __name__ == "__main__":
    main()
