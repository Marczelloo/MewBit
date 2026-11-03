"""Shared helpers for the Easy stage-2 analysis. Reads only Easy data and level-independent song facts."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]  # mapping-analysis/
SHARED = ROOT / "shared"
EASY = SHARED / "data" / "easy"
SONGS = SHARED / "data" / "songs"
ALGO_RAW = ROOT / "data" / "algo_charts" / "easy"
OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

MAIN_GENRES = ["anime", "electronic", "video game", "pop"]
FLAGGED = {126752, 1957138, 2162283, 2219350, 2288990}  # shared/alignment.md

CORPUS_COLS = ["set_id", "split", "artist", "title", "creator", "mappers", "genre", "genre_source", "year", "period",
               "bpm", "bpm_bin", "play_count", "favourite_count", "rating_mean", "rating_votes", "rating_bayes", "score",
               "easy_beatmap_id", "easy_version", "easy_stars", "easy_owners", "easy_notes", "easy_holds", "easy_hit_length"]


def corpus():
    return pd.read_csv(SHARED / "corpus.csv", usecols=CORPUS_COLS)


def metrics(who):
    df = pd.read_csv(EASY / f"{who}_metrics.csv")
    c = corpus()[["set_id", "artist", "title", "easy_owners", "mappers"]]
    df = df.merge(c, on="set_id", how="left").copy()
    df["owner"] = df["easy_owners"].astype(str)
    df["genre_g"] = df["genre"].where(df["genre"].isin(MAIN_GENRES), "inne")
    df["flagged"] = df["set_id"].isin(FLAGGED)
    return df


def metric_json(who, set_id):
    return json.loads((EASY / who / f"{set_id}.json").read_text())


def song(set_id):
    return json.loads((SONGS / f"{set_id}.json").read_text())


def notes(who, set_id):
    d = json.loads((EASY / "notes" / f"{who}_{set_id}.json").read_text())
    return d["notes"]


def slots(who, set_id, target="chosen"):
    """Slot table. Metrics v2: with target="chosen" (default) the targets `mapped`, `n_notes`, `hold_start` are the
    exclusive ones (one slot per moment: `chosen`, `chosen_n_notes`, `chosen_hold_start`); target="mapped" keeps the
    old +-25 ms ones."""
    z = np.load(EASY / "slots" / f"{who}_{set_id}.npz")
    d = {k: z[k] for k in z.files}
    if target == "chosen":
        d["mapped"], d["n_notes"], d["hold_start"] = d["chosen"], d["chosen_n_notes"], d["chosen_hold_start"]
    return d


def q(s, qs=(0.1, 0.5, 0.9)):
    s = pd.Series(s).dropna().astype(float)
    if len(s) == 0:
        return [np.nan] * len(qs)
    return [float(s.quantile(x)) for x in qs]


def fmt(v, nd=2):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "–"
    if abs(v) >= 100:
        return f"{v:.0f}"
    return f"{v:.{nd}f}"


def qstr(s, nd=2):
    a, b, c = q(s)
    return f"{fmt(a, nd)} / {fmt(b, nd)} / {fmt(c, nd)}"


def nmap(df):
    """n maps, n distinct diff owners, n distinct set hosts."""
    return f"n={len(df)}, mapperzy={df['owner'].nunique()}, hostów={df['creator'].nunique()}"


def mmss(ms):
    s = max(0, int(round(ms / 1000)))
    return f"{s // 60:02d}:{s % 60:02d}"
