"""Wspólne funkcje analizy etapu 2 dla poziomu Normal.

Czyta wyłącznie dane poziomu normal (shared/data/normal), fakty o utworach (shared/data/songs)
i ogólne kolumny + kolumny normal_* korpusu. Nic nie zapisuje poza levels/normal/.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=pd.errors.PerformanceWarning)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # mapping-analysis/
SHARED = ROOT / "shared"
DATA = SHARED / "data" / "normal"
SONGS = SHARED / "data" / "songs"
RESULTS = HERE / "results"
RESULTS.mkdir(exist_ok=True)

MAIN_GENRES = ["anime", "electronic", "video game", "pop"]
ZERO_FILL = [f"gap_share.{k}" for k in ["8", "6", "4", "3", "2", "3/2", "1", "3/4", "2/3", "1/2", "1/3", "1/4", "1/6", "1/8", "1/12", "1/16"]]
FLAGGED = {126752, 1957138, 2162283, 2219350, 2288990}  # alignment.md: dopasowanie do audio do ostrożnego traktowania


def _zero_fill(df: pd.DataFrame) -> pd.DataFrame:
    """Brak klasy odstępu w mapie (NaN albo brak kolumny) = udział 0."""
    for k in ZERO_FILL:
        df[k] = df[k].fillna(0.0) if k in df else 0.0
    return df.copy()


def corpus() -> pd.DataFrame:
    c = pd.read_csv(SHARED / "corpus.csv")
    keep = [x for x in c.columns if not x.startswith("easy_") and not x.startswith("hard_")]
    general = ["set_id", "split", "artist", "title", "creator", "mappers", "genre", "genre_source", "year", "period",
               "bpm", "bpm_bin", "play_count", "favourite_count", "rating_mean", "rating_votes", "rating_bayes", "score"]
    keep = [x for x in keep if x in general or x.startswith("normal_")]
    return c[keep]


def human() -> pd.DataFrame:
    h = pd.read_csv(DATA / "human_metrics.csv")
    c = corpus()[["set_id", "artist", "title", "normal_owners"]]
    h = h.merge(c, on="set_id", how="left")
    h["owner"] = h["normal_owners"].astype("Int64").astype(str)
    h["genre4"] = np.where(h["genre"].isin(MAIN_GENRES), h["genre"], "other(small)")
    return _zero_fill(h)


def algo() -> pd.DataFrame:
    a = pd.read_csv(DATA / "algo_metrics.csv")
    c = corpus()[["set_id", "artist", "title"]]
    a = a.merge(c, on="set_id", how="left")
    a["genre4"] = np.where(a["genre"].isin(MAIN_GENRES), a["genre"], "other(small)")
    return _zero_fill(a)


def song(set_id: int) -> dict:
    return json.loads((SONGS / f"{set_id}.json").read_text())


def metrics_json(who: str, set_id: int) -> dict:
    return json.loads((DATA / who / f"{set_id}.json").read_text())


def notes(who: str, set_id: int) -> np.ndarray:
    """[[t_ms, lane, end_ms or nan], ...] jako tablica float (oś audio)."""
    d = json.loads((DATA / "notes" / f"{who}_{set_id}.json").read_text())
    arr = np.array([[n[0], n[1], np.nan if n[2] is None else n[2]] for n in d["notes"]], dtype=float)
    return arr


def slots(who: str, set_id: int) -> dict:
    z = np.load(DATA / "slots" / f"{who}_{set_id}.npz")
    return {k: z[k] for k in z.files}


def q(x, ps=(10, 50, 90)):
    x = pd.to_numeric(pd.Series(x), errors="coerce").dropna()
    if len(x) == 0:
        return [np.nan] * len(ps)
    return [float(np.percentile(x, p)) for p in ps]


def fmt(v, nd=2):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return "—"
    if abs(v) >= 100:
        return f"{v:.0f}"
    if abs(v) >= 10:
        return f"{v:.1f}"
    return f"{v:.{nd}f}"


def fmt_q(x, nd=2):
    a, b, c = q(x)
    return f"{fmt(a, nd)} / {fmt(b, nd)} / {fmt(c, nd)}"


def n_maps_mappers(df: pd.DataFrame) -> str:
    return f"n={len(df)} map, {df['owner'].nunique()} mapperów"


def mmss(ms: float) -> str:
    s = int(round(ms / 1000))
    return f"{s // 60:02d}:{s % 60:02d}"


def md_table(rows: list[list], header: list[str]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)
