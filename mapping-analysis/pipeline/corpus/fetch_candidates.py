"""Every Ranked osu!mania beatmapset with a 4K difficulty, with the metadata the selection needs.

    OSU_CLIENT_ID=... OSU_CLIENT_SECRET=... python3 -I fetch_candidates.py --out data/corpus

1. Pages through GET /beatmapsets/search (m=3, s=ranked, q="keys=4", sort=ranked_asc) and keeps every set that has a
   Ranked mania difficulty with 4 keys.
2. Fetches GET /beatmapsets/{id} for each (ratings, genre, language, per-difficulty owners).
Writes <out>/candidates.json (one record per set) and <out>/snapshot.json (when and how it was fetched). Responses are
cached in <out>/api-cache, so an interrupted run resumes. Nothing about the credentials is written.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from osu_api import OsuApi  # noqa: E402

SEARCH = {"m": 3, "s": "ranked", "q": "keys=4", "sort": "ranked_asc"}


def is_4k(b: dict) -> bool:
    mode = b.get("mode")
    return (mode == "mania" or b.get("mode_int") == 3) and round(float(b.get("cs", 0))) == 4


def ratings_of(detail: dict) -> tuple[float | None, int]:
    r = detail.get("ratings") or []
    if len(r) < 11:
        return None, 0
    votes = sum(r[1:11])
    return (sum(i * r[i] for i in range(1, 11)) / votes if votes else None), votes


def owners_of(b: dict) -> list[int]:
    owners = [o.get("id") for o in b.get("owners") or [] if o.get("id")]
    return owners or ([b["user_id"]] if b.get("user_id") else [])


def record(detail: dict) -> dict:
    mean, votes = ratings_of(detail)
    genre = detail.get("genre") or {}
    language = detail.get("language") or {}
    diffs = []
    for b in detail.get("beatmaps") or []:
        if not is_4k(b) or b.get("status") not in ("ranked", None):
            continue
        diffs.append({
            "beatmap_id": b.get("id"), "version": b.get("version"), "stars": b.get("difficulty_rating"),
            "owners": owners_of(b), "notes": b.get("count_circles"), "holds": b.get("count_sliders"),
            "total_length": b.get("total_length"), "hit_length": b.get("hit_length"), "bpm": b.get("bpm"),
            "od": b.get("accuracy"), "hp": b.get("drain"), "playcount": b.get("playcount"),
        })
    return {
        "set_id": detail.get("id"), "title": detail.get("title"), "artist": detail.get("artist"),
        "creator": detail.get("creator"), "creator_id": detail.get("user_id"), "status": detail.get("status"),
        "ranked_date": detail.get("ranked_date"), "submitted_date": detail.get("submitted_date"),
        "bpm": detail.get("bpm"), "play_count": detail.get("play_count"), "favourite_count": detail.get("favourite_count"),
        "rating_mean": mean, "rating_votes": votes, "genre_id": genre.get("id"), "genre_name": genre.get("name"),
        "language": language.get("name"), "tags": detail.get("tags") or "", "source": detail.get("source") or "",
        "nsfw": detail.get("nsfw"), "video": detail.get("video"), "diffs": diffs,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-pages", type=int, default=1000)
    args = ap.parse_args(argv)
    api = OsuApi(args.out / "api-cache")
    started = dt.datetime.now(dt.timezone.utc).isoformat()

    ids: list[int] = []
    cursor = None
    for page in range(args.max_pages):
        params = dict(SEARCH)
        if cursor:
            params["cursor_string"] = cursor
        data = api.get("/beatmapsets/search", params)
        for s in data.get("beatmapsets") or []:
            if s.get("status") == "ranked" and any(is_4k(b) and b.get("status", "ranked") == "ranked" for b in s.get("beatmaps") or []):
                ids.append(int(s["id"]))
        cursor = data.get("cursor_string")
        print(f"search page {page + 1}: {len(ids)} sets so far", flush=True)
        if not cursor:
            break
    ids = sorted(set(ids))

    records = []
    for i, sid in enumerate(ids):
        records.append(record(api.get(f"/beatmapsets/{sid}")))
        if (i + 1) % 100 == 0:
            print(f"details {i + 1}/{len(ids)}", flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "candidates.json").write_text(json.dumps(records))
    (args.out / "snapshot.json").write_text(json.dumps({"started": started, "finished": dt.datetime.now(dt.timezone.utc).isoformat(),
                                                        "search": SEARCH, "sets": len(records)}, indent=2))
    print(f"{len(records)} candidate sets -> {args.out / 'candidates.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
