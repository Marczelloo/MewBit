"""Invariants of corpus selection on synthetic candidates (no API data): caps, quotas, mapper-disjoint split, determinism.

    python3 -I test_select_synthetic.py
"""

import random
import sys
import tempfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "corpus"))
import select_corpus as sc  # noqa: E402

RANGES = {"easy": (0.0, 2.0), "normal": (2.0, 2.7), "hard": (2.7, 4.0)}


def fake(seed: int, n: int = 1500, easy_rare: bool = False) -> list[dict]:
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        host = rnd.randint(1, 400)
        diffs = []
        for k in range(rnd.randint(1, 5)):
            stars = rnd.choice([1.4, 1.8, 2.2, 2.5, 3.0, 3.6, 4.5, 5.5]) + rnd.uniform(-0.15, 0.15)
            if easy_rare and stars < 2.0 and rnd.random() < 0.8:
                stars += 2.5
            owner = host if rnd.random() < 0.8 else rnd.randint(1, 400)
            diffs.append({"beatmap_id": i * 10 + k, "version": f"d{k}", "stars": round(stars, 2), "owners": [owner],
                          "notes": 500, "holds": 50, "hit_length": rnd.randint(60, 240), "total_length": 200, "bpm": 170})
        votes = rnd.randint(0, 300)
        out.append({"set_id": 1000 + i, "title": f"t{i}", "artist": "a", "creator": f"m{host}", "creator_id": host, "status": "ranked",
                    "ranked_date": f"{rnd.randint(2009, 2026)}-05-01T00:00:00Z", "bpm": rnd.uniform(80, 260),
                    "play_count": int(rnd.lognormvariate(11, 1.5)), "favourite_count": int(rnd.lognormvariate(5, 1.2)),
                    "rating_mean": rnd.uniform(6, 10) if votes else None, "rating_votes": votes,
                    "genre_id": rnd.choice([1, 2, 3, 4, 5, 6, 9, 10, 11]), "tags": rnd.choice(["", "anime tv size", "touhou", "edm hardcore", "j-pop"]),
                    "source": "", "diffs": diffs})
    return out


def check(cands_raw):
    cands, info = sc.prepare(cands_raw, RANGES)
    sets, dev = sc.select(cands)
    splits = sc.split(sets)
    assert len(sets) == sc.TARGET or dev, (len(sets), dev)
    g = Counter(s["genre"] for s in sets)
    assert max(g.values()) <= sc.MAX_PER_GENRE, g
    m = Counter(x for s in sets for x in s["mappers"])
    assert max(m.values()) <= sc.MAX_PER_MAPPER, m.most_common(3)
    assert max(Counter(s["period"] for s in sets).values()) <= sc.MAX_PER_PERIOD
    assert max(Counter(s["bpm_bin"] for s in sets).values()) <= sc.MAX_PER_BPM_BIN
    per_level = {l: sum(l in s["levels"] for s in sets) for l in sc.LEVELS}
    for l, n in per_level.items():
        assert n >= sc.MIN_PER_LEVEL or any(l in d for d in dev), (l, n, dev)
    test = {s["set_id"] for s in sets if splits[s["set_id"]] == "test"}
    assert len(test) <= sc.TEST
    train_m = {x for s in sets if s["set_id"] not in test for x in s["mappers"]}
    test_m = {x for s in sets if s["set_id"] in test for x in s["mappers"]}
    assert not train_m & test_m, train_m & test_m
    sets2, _ = sc.select(sc.prepare(cands_raw, RANGES)[0])
    assert [s["set_id"] for s in sets] == [s["set_id"] for s in sets2], "not deterministic"
    with tempfile.TemporaryDirectory() as tmp:
        sc.write(sets, splits, info, dev, RANGES, {"finished": "synthetic"}, Path(tmp))
        assert (Path(tmp) / "corpus.csv").read_text().count("\n") == len(sets) + 1
    return per_level, len(test), dict(g), dev, sum(len(s["levels"]) == 3 for s in sets)


if __name__ == "__main__":
    print("normal pool:", check(fake(1)))
    print("Easy rare:  ", check(fake(2, easy_rare=True)))
    print("small pool: ", check(fake(3, n=150)))
    print("ok")
