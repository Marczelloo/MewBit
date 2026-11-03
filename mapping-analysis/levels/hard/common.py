"""Wspólne funkcje dla analiz poziomu Hard (etap 2). Czyta wyłącznie dane hard."""
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # mapping-analysis/
SHARED = os.path.join(ROOT, "shared")
DATA = os.path.join(SHARED, "data", "hard")
SONGS = os.path.join(SHARED, "data", "songs")
ALGO_RAW = os.path.join(ROOT, "data", "algo_charts", "hard")
TABLES = os.path.join(HERE, "tables")
os.makedirs(TABLES, exist_ok=True)

BIG_GENRES = ["anime", "electronic", "video game", "pop"]
FLAGGED = {126752, 1957138, 2162283, 2219350, 2288990}  # alignment.md

CORPUS_COLS = ["set_id", "split", "artist", "title", "creator", "mappers", "genre", "genre_source", "year", "period",
               "bpm", "bpm_bin", "play_count", "favourite_count", "rating_mean", "rating_votes", "rating_bayes", "score"]


def corpus():
    c = pd.read_csv(os.path.join(SHARED, "corpus.csv"))
    cols = CORPUS_COLS + [x for x in c.columns if x.startswith("hard_")]
    return c[[x for x in cols if x in c.columns]]


GAP_CLASSES = ["8", "6", "4", "3", "2", "3/2", "1", "3/4", "2/3", "1/2", "1/3", "1/4", "1/6", "1/8", "1/12", "1/16", "other"]


def fill_shares(df):
    """Brak klucza w gap_share = 0 (JSON zapisuje tylko klasy obecne w mapie)."""
    for g in GAP_CLASSES:
        col = f"gap_share.{g}"
        if col not in df.columns:
            df[col] = 0.0
        df[col] = df[col].fillna(0.0)
    return df.copy()


def human():
    h = pd.read_csv(os.path.join(DATA, "human_metrics.csv"))
    c = corpus()[["set_id", "artist", "title", "hard_owners", "hard_version"]]
    h = h.merge(c, on="set_id", how="left").copy()
    h = fill_shares(h)
    h["owner"] = h["hard_owners"].astype(str)
    h["genre4"] = np.where(h["genre"].isin(BIG_GENRES), h["genre"], "other")
    return h


def algo():
    a = pd.read_csv(os.path.join(DATA, "algo_metrics.csv"))
    c = corpus()[["set_id", "artist", "title"]]
    a = a.merge(c, on="set_id", how="left").copy()
    a = fill_shares(a)
    a["genre4"] = np.where(a["genre"].isin(BIG_GENRES), a["genre"], "other")
    return a


def metrics_json(who, set_id):
    with open(os.path.join(DATA, who, f"{set_id}.json")) as f:
        return json.load(f)


def song(set_id):
    with open(os.path.join(SONGS, f"{set_id}.json")) as f:
        return json.load(f)


def notes(who, set_id):
    with open(os.path.join(DATA, "notes", f"{who}_{set_id}.json")) as f:
        return json.load(f)["notes"]


def slots(who, set_id):
    z = np.load(os.path.join(DATA, "slots", f"{who}_{set_id}.npz"))
    return {k: z[k] for k in z.files}


def q(series, qs=(0.1, 0.5, 0.9)):
    s = pd.Series(series).dropna()
    if len(s) == 0:
        return [np.nan] * len(qs)
    return [float(s.quantile(x)) for x in qs]


def fmt(x, nd=2):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "–"
    if abs(x) >= 100:
        return f"{x:.0f}"
    if abs(x) >= 10:
        return f"{x:.1f}"
    return f"{x:.{nd}f}"


def mmss(ms):
    s = max(0, int(round(ms / 1000)))
    return f"{s // 60}:{s % 60:02d}"


TOL_MS = 25.0


def chosen_target(z, nts, binary_first=None):
    """Official exclusive slot target (metrics v2): `chosen`, `chosen_n_notes`. Returns (chosen, n_notes, moments without slot).
    `binary_first` is kept for the old call signature; the pipeline already gives each moment one slot (the coarsest
    division within its source's tolerance, else the nearest slot within 25 ms)."""
    chosen = z["chosen"].astype(bool)
    nn = z["chosen_n_notes"].astype(int)
    moments = len(set(n[0] for n in nts))
    return chosen, nn, moments - int(chosen.sum())
