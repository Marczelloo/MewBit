"""Selects the 100-song corpus from the API candidates (criteria: shared/corpus_selection.md, written by this script).

    python3 -I select_corpus.py --candidates data/corpus/candidates.json --levels shared/levels.json \
        --snapshot data/corpus/snapshot.json --out shared

Writes shared/corpus.csv, shared/corpus_selection.md and shared/download-list.md. Deterministic: the same
candidates and levels give the same corpus. A quota that cannot be met is written down as a deviation, never relaxed
silently.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

LEVELS = ("easy", "normal", "hard")
TARGET = 100
TEST = 20
MIN_PER_LEVEL = 60
MAX_PER_GENRE = 25
MIN_GENRES = 6
MAX_PER_MAPPER = 3
MAX_PER_PERIOD = 35  # of 100: no 3-year period holds more than about a third
MAX_PER_BPM_BIN = 40
# BPM spread: each BPM bin holds between BPM_FLOOR_RATIO and BPM_CAP_RATIO times its share among the population's full
# sets (sets with all three levels), and never more than MAX_PER_BPM_BIN. Popularity alone over-picks fast songs.
BPM_FLOOR_RATIO = 0.8
BPM_CAP_RATIO = 1.25
# How this rule got here (also written to corpus_selection.md): the first selection had only a fixed 40-per-bin cap and
# gave 10 % of songs under 150 BPM against 25 % among the population's full sets; 0.5x-1.5x still gave 12 %. The game
# mostly plays songs under 150 BPM, so the corpus is held representative of the population's tempo spread instead.
CRITERIA_HISTORY = [
    "Przebieg 1: tylko limit 40 na przedział BPM → < 150 BPM: 10 utworów (populacja pełnych zestawów: 25%), ≥ 210 BPM: 21 (populacja: 7%).",
    "Przebieg 2: przedział BPM 0,5×–1,5× udziału w populacji → < 150 BPM: 12 utworów, ≥ 210 BPM: 11.",
    "Przebieg 3 (obowiązujący): 0,8×–1,25× udziału w populacji, bo gra gra głównie utwory < 150 BPM, a 12 utworów to za mała grupa do wniosków.",
]
MIN_HIT_LENGTH_S = 30
GROUP_MIN = 15  # a (genre, period) group smaller than this is normalised within its period alone
RATING_PRIOR_VOTES = 10  # Bayesian average: m votes of the global mean
WEIGHTS = {"plays": 0.40, "favs": 0.25, "rating": 0.35}
PERIOD_START, PERIOD_YEARS = 2007, 3
BPM_BINS = (0, 120, 150, 180, 210, 10_000)

API_GENRES = {2: "video game", 3: "anime", 4: "rock", 5: "pop", 6: "other", 7: "novelty", 9: "hip hop",
              10: "electronic", 11: "metal", 12: "classical", 13: "folk", 14: "jazz"}
# Tag / source / title keywords for sets the API leaves "unspecified" or "other" (first match wins).
TAG_GENRES = [
    ("anime", r"\b(anime|tv size|tv ver|opening|ending|\bop\b|\bed\b|insert song)\b"),
    ("video game", r"\b(game|touhou|東方|vocaloid|bms|beatmania|iidx|sdvx|sound voltex|maimai|chunithm|arcaea|cytus|deemo|dj ?max|ddr|pump it up|undertale|deltarune|nintendo|pokemon)\b"),
    ("metal", r"\b(metal|metalcore|deathcore|djent)\b"),
    ("rock", r"\b(rock|punk|j-?rock|grunge|emo)\b"),
    ("hip hop", r"\b(hip ?hop|rap|trap)\b"),
    ("electronic", r"\b(electronic|edm|house|techno|trance|dubstep|drum ?(and|&|n) ?bass|dnb|hardcore|hardstyle|speedcore|frenchcore|breakcore|future bass|electro|synth|chiptune|eurobeat|happy hardcore)\b"),
    ("pop", r"\b(pop|j-?pop|k-?pop|idol)\b"),
    ("jazz", r"\b(jazz|swing|big band)\b"),
    ("classical", r"\b(classical|orchestra|piano|symphony|baroque)\b"),
    ("folk", r"\b(folk|celtic|acoustic)\b"),
]


# Cuts of one recording are one song: "(TV Size)", "(Cut Ver.)", "(Short Ver.)", "(Game Ver.)" and the like are dropped
# from the title. Remixes and covers keep their own key (different music).
VERSION_TAG = re.compile(r"\s*[\(\[][^\)\]]*\b(tv ?size|cut ver|short ver|game ver|full ver|extended|sped up|ver\.)[^\)\]]*[\)\]]", re.I)


def song_key(s: dict) -> str:
    norm = lambda x: re.sub(r"[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]+", "", (x or "").lower())
    return f"{norm(s.get('artist'))}|{norm(VERSION_TAG.sub('', s.get('title') or ''))}"


def period_of(year: int) -> str:
    a = PERIOD_START + ((year - PERIOD_START) // PERIOD_YEARS) * PERIOD_YEARS
    return f"{a}-{a + PERIOD_YEARS - 1}"


def bpm_bin(bpm: float) -> str:
    for a, b in zip(BPM_BINS, BPM_BINS[1:]):
        if a <= bpm < b:
            return f"{a}-{b}" if b < 10_000 else f">={a}"
    return "?"


def genre_of(s: dict) -> tuple[str, str]:
    g = API_GENRES.get(s.get("genre_id") or 0)
    if g and g != "other":
        return g, "api"
    text = " ".join([s.get("tags") or "", s.get("source") or "", s.get("title") or ""]).lower()
    for name, rx in TAG_GENRES:
        if re.search(rx, text):
            return name, "tags"
    return ("other", "api") if g == "other" else ("unknown", "none")


def percentiles(values: list[float]) -> list[float]:
    """Mid-rank percentile in 0..1 (ties share their mean rank)."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 0.5
        i = j + 1
    n = len(values)
    return [r / n for r in ranks]


def choose_diff(s: dict, level: str, ranges: dict, typical: dict) -> dict | None:
    a, b = ranges[level]
    inside = [d for d in s["diffs"] if d.get("stars") is not None and a <= d["stars"] < b and (d.get("hit_length") or 0) >= MIN_HIT_LENGTH_S]
    if not inside:
        return None
    host = s.get("creator_id")
    return min(inside, key=lambda d: (abs(d["stars"] - typical[level]), 0 if host in d["owners"] else 1, d["beatmap_id"]))


def prepare(cands: list[dict], ranges: dict) -> tuple[list[dict], dict]:
    cands = [s for s in cands if s.get("status") == "ranked" and s.get("diffs")]
    typical = {}
    for level in LEVELS:
        a, b = ranges[level]
        vals = sorted(d["stars"] for s in cands for d in s["diffs"] if d.get("stars") is not None and a <= d["stars"] < b)
        typical[level] = vals[len(vals) // 2] if vals else (a + b) / 2
    rated = [s["rating_mean"] for s in cands if s.get("rating_votes")]
    global_mean = sum(rated) / len(rated) if rated else 5.0
    out = []
    for s in cands:
        chosen = {lvl: choose_diff(s, lvl, ranges, typical) for lvl in LEVELS}
        if not any(chosen.values()):
            continue
        year = int((s.get("ranked_date") or "2000")[:4])
        genre, source = genre_of(s)
        votes = s.get("rating_votes") or 0
        bayes = ((s.get("rating_mean") or 0) * votes + global_mean * RATING_PRIOR_VOTES) / (votes + RATING_PRIOR_VOTES)
        mappers = {s.get("creator_id")} | {o for d in chosen.values() if d for o in d["owners"]}
        out.append({**s, "chosen": chosen, "levels": [l for l in LEVELS if chosen[l]], "year": year, "period": period_of(year),
                    "genre": genre, "genre_source": source, "rating_bayes": bayes, "mappers": sorted(m for m in mappers if m),
                    "bpm_bin": bpm_bin(float(s.get("bpm") or 0)), "song": song_key(s)})
    # Normalise popularity and rating inside (genre, period); small groups inside their period.
    groups = defaultdict(list)
    for s in out:
        groups[(s["genre"], s["period"])].append(s)
    by_period = defaultdict(list)
    for s in out:
        by_period[s["period"]].append(s)
    for s in out:
        g = groups[(s["genre"], s["period"])]
        s["group"], s["group_fallback"] = (f"{s['genre']}|{s['period']}", False) if len(g) >= GROUP_MIN else (f"*|{s['period']}", True)
    pools = defaultdict(list)
    for s in out:
        pools[s["group"]].append(s)
    for pool in pools.values():
        for key, value in (("pct_plays", lambda x: math.log1p(x.get("play_count") or 0)),
                           ("pct_favs", lambda x: math.log1p(x.get("favourite_count") or 0)),
                           ("pct_rating", lambda x: x["rating_bayes"])):
            for s, p in zip(pool, percentiles([value(x) for x in pool])):
                s[key] = p
    for s in out:
        s["score"] = WEIGHTS["plays"] * s["pct_plays"] + WEIGHTS["favs"] * s["pct_favs"] + WEIGHTS["rating"] * s["pct_rating"]
    return out, {"typical_stars": typical, "rating_global_mean": global_mean, "groups": {k: len(v) for k, v in pools.items()}}


def bpm_limits(cands: list[dict]) -> dict[str, tuple[int, int]]:
    """{bpm bin: (floor, cap)} from the BPM shares of the population's full sets."""
    full = [s for s in cands if len(s["levels"]) == len(LEVELS)] or cands
    share = Counter(s["bpm_bin"] for s in full)
    return {b: (int(math.floor(BPM_FLOOR_RATIO * n / len(full) * TARGET)),
                min(MAX_PER_BPM_BIN, int(math.ceil(BPM_CAP_RATIO * n / len(full) * TARGET)))) for b, n in share.items()}


class Picks:
    def __init__(self, bpm_cap: dict[str, int] | None = None):
        self.sets: list[dict] = []
        self.bpm_cap = bpm_cap or {}
        self.songs = Counter()
        self.genre, self.mapper, self.period, self.bpm, self.level = Counter(), Counter(), Counter(), Counter(), Counter()

    def fits(self, s: dict) -> bool:
        return (self.songs[s["song"]] == 0 and self.genre[s["genre"]] < MAX_PER_GENRE and all(self.mapper[m] < MAX_PER_MAPPER for m in s["mappers"])
                and self.period[s["period"]] < MAX_PER_PERIOD and self.bpm[s["bpm_bin"]] < self.bpm_cap.get(s["bpm_bin"], MAX_PER_BPM_BIN))

    def add(self, s: dict, sign: int = 1) -> None:
        self.songs[s["song"]] += sign
        self.genre[s["genre"]] += sign
        self.period[s["period"]] += sign
        self.bpm[s["bpm_bin"]] += sign
        for m in s["mappers"]:
            self.mapper[m] += sign
        for l in s["levels"]:
            self.level[l] += sign
        (self.sets.append(s) if sign > 0 else self.sets.remove(s))


def select(cands: list[dict]) -> tuple[list[dict], list[str], dict]:
    deviations: list[str] = []
    limits = bpm_limits(cands)
    floor = {b: lo for b, (lo, _) in limits.items()}
    order = sorted(cands, key=lambda s: (-len(s["levels"]), -s["score"], s["set_id"]))
    picks = Picks({b: hi for b, (_, hi) in limits.items()})
    for s in order:
        if len(picks.sets) >= TARGET:
            break
        if picks.fits(s):
            picks.add(s)
    if len(picks.sets) < TARGET:
        deviations.append(f"only {len(picks.sets)} sets fit the caps (target {TARGET})")

    def repair(has) -> bool:
        """Swaps the weakest selected set without `has` for the best unselected set with it, if the caps allow and no
        level or BPM bin falls below min(quota, its count before the swap) and no genre disappears."""
        before = dict(picks.level)
        before_bpm = dict(picks.bpm)
        chosen = {s["set_id"] for s in picks.sets}
        for cand in sorted((s for s in cands if s["set_id"] not in chosen and has(s)), key=lambda s: (-s["score"], s["set_id"])):
            for out in sorted((s for s in picks.sets if not has(s)), key=lambda s: (s["score"], s["set_id"])):
                picks.add(out, -1)
                if picks.fits(cand):
                    picks.add(cand)
                    levels_ok = all(picks.level[l] >= min(MIN_PER_LEVEL, before.get(l, 0)) for l in LEVELS)
                    genre_ok = picks.genre[out["genre"]] > 0 or out["genre"] == cand["genre"]
                    bpm_ok = all(picks.bpm[b] >= min(floor.get(b, 0), before_bpm.get(b, 0)) for b in floor)
                    if levels_ok and genre_ok and bpm_ok:
                        return True
                    picks.add(cand, -1)
                picks.add(out, +1)
        return False

    for level in LEVELS:
        while picks.level[level] < MIN_PER_LEVEL:
            if not repair(lambda s, level=level: level in s["levels"]):
                deviations.append(f"{level}: only {picks.level[level]} sets (quota {MIN_PER_LEVEL}); no swap within the caps found")
                break
    while True:
        present = {g for g in picks.genre if picks.genre[g] > 0 and g != "unknown"}
        if len(present) >= MIN_GENRES:
            break
        if not repair(lambda s, present=present: s["genre"] not in present and s["genre"] != "unknown"):
            deviations.append(f"only {len(present)} genres reachable (quota {MIN_GENRES})")
            break
    for b in sorted(floor):
        while picks.bpm[b] < floor[b]:
            if not repair(lambda s, b=b: s["bpm_bin"] == b):
                deviations.append(f"BPM {b}: only {picks.bpm[b]} sets (floor {floor[b]}); no swap within the caps found")
                break
    for cap, counter, limit in (("genre", picks.genre, MAX_PER_GENRE), ("period", picks.period, MAX_PER_PERIOD)):
        over = {k: v for k, v in counter.items() if v > limit}
        if over:
            deviations.append(f"{cap} cap exceeded: {over}")
    over = {b: v for b, v in picks.bpm.items() if v > picks.bpm_cap.get(b, MAX_PER_BPM_BIN)}
    if over:
        deviations.append(f"BPM cap exceeded: {over}")
    return sorted(picks.sets, key=lambda s: s["set_id"]), deviations, limits


def split(sets: list[dict]) -> dict[int, str]:
    """80/20 by mapper components (sets sharing any mapper stay together), genre-proportional, full sets first in test."""
    parent = {s["set_id"]: s["set_id"] for s in sets}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    by_mapper = defaultdict(list)
    for s in sets:
        for m in s["mappers"]:
            by_mapper[m].append(s["set_id"])
    for ids in by_mapper.values():
        for a in ids[1:]:
            parent[find(a)] = find(ids[0])
    comps = defaultdict(list)
    for s in sets:
        comps[find(s["set_id"])].append(s)
    genre_total = Counter(s["genre"] for s in sets)
    raw = {g: TEST * n / len(sets) for g, n in genre_total.items()}
    target = {g: int(v) for g, v in raw.items()}
    for g in sorted(raw, key=lambda g: -(raw[g] - int(raw[g])))[: TEST - sum(target.values())]:
        target[g] += 1
    taken = Counter()
    test: set[int] = set()
    ordered = sorted(comps.values(), key=lambda c: (-sum(len(s["levels"]) == 3 for s in c) / len(c), len(c), -max(s["score"] for s in c), min(s["set_id"] for s in c)))
    for strict in (True, False):
        for comp in ordered:
            ids = {s["set_id"] for s in comp}
            if ids & test or len(test) + len(comp) > TEST:
                continue
            g = Counter(s["genre"] for s in comp)
            if strict and any(taken[k] + v > target.get(k, 0) for k, v in g.items()):
                continue
            test |= ids
            taken.update(g)
    return {s["set_id"]: ("test" if s["set_id"] in test else "train") for s in sets}


def write(sets, splits, info, deviations, ranges, snapshot, out: Path, limits: dict | None = None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    cols = ["set_id", "split", "artist", "title", "creator", "creator_id", "mappers", "genre", "genre_source", "language",
            "ranked_date", "year", "period", "bpm", "bpm_bin", "play_count", "favourite_count", "rating_mean", "rating_votes",
            "rating_bayes", "group", "group_fallback", "pct_plays", "pct_favs", "pct_rating", "score", "levels", "full_set"]
    for l in LEVELS:
        cols += [f"{l}_beatmap_id", f"{l}_version", f"{l}_stars", f"{l}_owners", f"{l}_notes", f"{l}_holds", f"{l}_hit_length"]
    with open(out / "corpus.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for s in sets:
            row = {k: s.get(k) for k in cols}
            row.update(split=splits[s["set_id"]], mappers="|".join(map(str, s["mappers"])), levels="|".join(s["levels"]), full_set=len(s["levels"]) == 3)
            for k in ("pct_plays", "pct_favs", "pct_rating", "score", "rating_bayes", "rating_mean"):
                row[k] = None if s.get(k) is None else round(s[k], 4)
            for l in LEVELS:
                d = s["chosen"][l]
                if d:
                    row.update({f"{l}_beatmap_id": d["beatmap_id"], f"{l}_version": d["version"], f"{l}_stars": d["stars"],
                                f"{l}_owners": "|".join(map(str, d["owners"])), f"{l}_notes": d["notes"], f"{l}_holds": d["holds"], f"{l}_hit_length": d["hit_length"]})
            w.writerow(row)

    def dist(key, subset=sets):
        return dict(sorted(Counter(s[key] for s in subset).items(), key=lambda kv: (-kv[1], str(kv[0]))))
    test = [s for s in sets if splits[s["set_id"]] == "test"]
    lines = [
        "# Korpus: kryteria i wynik selekcji", "",
        f"Wygenerowane przez `pipeline/corpus/select_corpus.py` z migawki API {snapshot.get('finished', '?')} "
        f"(wyszukiwanie: `{snapshot.get('search')}`). Uruchomienie ponowne na tych samych plikach daje ten sam wynik.", "",
        "## Wzór", "",
        f"`score = {WEIGHTS['plays']}·pct(log(1+plays)) + {WEIGHTS['favs']}·pct(log(1+favourites)) + {WEIGHTS['rating']}·pct(rating_bayes)`", "",
        f"- `pct` = percentyl (mid-rank) w grupie (gatunek, okres {PERIOD_YEARS}-letni wg daty rankingu); grupa < {GROUP_MIN} zestawów → percentyl w samym okresie.",
        f"- `rating_bayes = (średnia·głosy + {info['rating_global_mean']:.3f}·{RATING_PRIOR_VOTES}) / (głosy + {RATING_PRIOR_VOTES})` (średnia globalna kandydatów).",
        "- Gatunek: z API; dla `unspecified`/`other` uzupełniony z tagów/źródła/tytułu (kolumna `genre_source` = `tags`), inaczej `unknown`.", "",
        "## Poziomy", "", f"Zakresy SR (`shared/levels.json`): {json.dumps(ranges)}; typowy SR (mediana w zakresie): "
        f"{json.dumps({k: round(v, 2) for k, v in info['typical_stars'].items()})}. Na poziom jedna dyfficulty: najbliższa typowemu SR, "
        f"remis → dyfficulty hosta → niższe id; tylko dyfficulty 4K Ranked o hit length ≥ {MIN_HIT_LENGTH_S} s.", "",
        "## Kwoty", "",
        f"- {TARGET} zestawów, każdy inna piosenka (`song_key`: wykonawca + tytuł bez dopisków wersji typu „TV Size”, „Cut Ver.”); pierwszeństwo: liczba poziomów (3 > 2 > 1), potem score.",
        f"- ≥ {MIN_PER_LEVEL} zestawów na poziom; ≤ {MAX_PER_GENRE} na gatunek; ≥ {MIN_GENRES} gatunków; ≤ {MAX_PER_MAPPER} zestawy na mappera "
        "(host zestawu i właściciele wybranych dyfficulty liczą się razem);",
        f"  ≤ {MAX_PER_PERIOD} na okres {PERIOD_YEARS}-letni; przedział BPM (granice {BPM_BINS[1:-1]}) między {BPM_FLOOR_RATIO}× a {BPM_CAP_RATIO}× "
        f"swojego udziału wśród pełnych zestawów populacji, maks. {MAX_PER_BPM_BIN}: (min, maks.) = {json.dumps(limits or {}, sort_keys=True)}.",
        f"- Podział: {TEST} test / {TARGET - TEST} trening, po składowych grafu mapperów (żaden mapper w obu częściach), proporcjonalnie do gatunków, zestawy pełne najpierw.", "",
        "## Wynik", "",
        f"- Zestawy: {len(sets)}; z kompletem poziomów: {sum(len(s['levels']) == 3 for s in sets)}; test: {len(test)} (pełnych: {sum(len(s['levels']) == 3 for s in test)}).",
        f"- Na poziom: { {l: sum(l in s['levels'] for s in sets) for l in LEVELS} }; w teście: { {l: sum(l in s['levels'] for s in test) for l in LEVELS} }.",
        f"- Gatunki: {dist('genre')}; źródło gatunku: {dist('genre_source')}.",
        f"- Gatunki w teście: {dist('genre', test)}.",
        f"- Okresy: {dist('period')}; BPM: {dist('bpm_bin')}.",
        f"- Mapperzy z największą liczbą zestawów: {Counter(m for s in sets for m in s['mappers']).most_common(5)}.",
        f"- Grupy normalizacji z fallbackiem do okresu: {sum(s['group_fallback'] for s in sets)} zestawów.", "",
        "## Odstępstwa od kwot", "", *([f"- {d}" for d in deviations] or ["- brak"]), "",
        "## Zmiany kryterium BPM w trakcie selekcji", "", *[f"- {h}" for h in CRITERIA_HISTORY], "",
    ]
    (out / "corpus_selection.md").write_text("\n".join(lines))
    dl = ["# Lista do pobrania (.osz)", "",
          "Pobieranie z osu! wymaga zalogowania, więc pobierz pliki ręcznie (przycisk Download na stronie zestawu, wariant bez wideo "
          "wystarczy) do folderu z map podanego w zadaniu. Nazwy plików mogą zostać takie, jakie nada osu! (zaczynają się od id zestawu).", "",
          "| # | set id | utwór | mapper | część | strona | pobierz |", "|---|---|---|---|---|---|---|"]
    for i, s in enumerate(sorted(sets, key=lambda s: (splits[s["set_id"]] != "test", s["set_id"])), 1):
        sid = s["set_id"]
        dl.append(f"| {i} | {sid} | {s['artist']} – {s['title']} | {s['creator']} | {splits[sid]} | https://osu.ppy.sh/beatmapsets/{sid} | "
                  f"https://osu.ppy.sh/beatmapsets/{sid}/download?noVideo=1 |")
    (out / "download-list.md").write_text("\n".join(dl) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=Path, required=True)
    ap.add_argument("--levels", type=Path, required=True)
    ap.add_argument("--snapshot", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    ranges = {k: tuple(v) for k, v in json.loads(args.levels.read_text())["ranges"].items()}
    cands, info = prepare(json.loads(args.candidates.read_text()), ranges)
    sets, deviations, limits = select(cands)
    splits = split(sets)
    snapshot = json.loads(args.snapshot.read_text()) if args.snapshot and args.snapshot.exists() else {}
    write(sets, splits, info, deviations, ranges, snapshot, args.out, limits)
    print(f"{len(sets)} sets ({sum(v == 'test' for v in splits.values())} test); deviations: {deviations or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
