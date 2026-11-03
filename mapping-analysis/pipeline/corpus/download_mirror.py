"""Downloads the corpus .osz files from a community beatmap mirror and checks each against the official osu! API.

    python3 -I download_mirror.py --mirror catboy --corpus shared/corpus.csv --cache data/corpus/api-cache --out data/osz

Only with the user's consent to that mirror (osu! itself needs a logged-in browser). A mirror is not trusted: a file
is kept only when it is a valid .osz and, for every difficulty the corpus chose from the set, it holds an .osu file
whose MD5 equals that difficulty's `checksum` in the official API response (cached by fetch_candidates.py). Files go
to --out as <set id>.osz; existing verified files are skipped, so a run resumes. One file at a time, with a pause.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

MIRRORS = {
    "catboy": "https://catboy.best/d/{id}n",
    "nerinyan": "https://api.nerinyan.moe/d/{id}?noVideo=true",
    "osudirect": "https://osu.direct/api/d/{id}?noVideo=1",
}
MAX_BYTES = 200 * 1024 * 1024
UA = "mapping-analysis/1.0 (corpus download for a research report)"


def official_checksums(cache: Path, set_id: int) -> dict[int, str]:
    """{beatmap id: md5 of its .osu} from the cached GET /beatmapsets/<id> response."""
    key = hashlib.sha1(f"/beatmapsets/{set_id}?".encode()).hexdigest()
    data = json.loads((cache / f"{key}.json").read_text())
    return {b["id"]: b["checksum"] for b in data.get("beatmaps", []) if b.get("checksum")}


def check(path: Path, wanted: dict[int, str]) -> str:
    try:
        with zipfile.ZipFile(path) as z:
            md5s = set()
            for info in z.infolist():
                if info.filename.lower().endswith(".osu") and info.file_size < 8 * 1024 * 1024:
                    md5s.add(hashlib.md5(z.read(info)).hexdigest())
    except (zipfile.BadZipFile, OSError) as e:
        return f"not an .osz ({type(e).__name__})"
    missing = [bid for bid, md5 in wanted.items() if md5 not in md5s]
    return "ok" if not missing else f"difficulties {missing} do not match the official checksums"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mirror", choices=sorted(MIRRORS), required=True)
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--delay", type=float, default=2.0)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many sets (0 = all); for a first trial")
    args = ap.parse_args(argv)
    with open(args.corpus, newline="", encoding="utf-8") as f:
        rows = sorted(csv.DictReader(f), key=lambda r: (r["split"] != "test", int(r["set_id"])))
    if args.limit:
        rows = rows[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)
    ok = failed = 0
    for i, r in enumerate(rows, 1):
        sid = int(r["set_id"])
        chosen = [int(r[f"{l}_beatmap_id"]) for l in ("easy", "normal", "hard") if r.get(f"{l}_beatmap_id")]
        sums = official_checksums(args.cache, sid)
        wanted = {b: sums[b] for b in chosen if b in sums}
        target = args.out / f"{sid}.osz"
        if target.exists() and check(target, wanted) == "ok":
            ok += 1
            continue
        result = "not downloaded"
        for attempt in range(3):
            req = urllib.request.Request(MIRRORS[args.mirror].format(id=sid), headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = resp.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    result = "too large"
                    break
                tmp = target.with_suffix(".part")
                tmp.write_bytes(body)
                result = check(tmp, wanted)
                if result == "ok":
                    tmp.replace(target)
                    break
                tmp.unlink(missing_ok=True)
            except urllib.error.HTTPError as e:
                result = f"HTTP {e.code}"
                if e.code == 404:
                    break
            except (urllib.error.URLError, OSError) as e:
                result = f"{type(e).__name__}"
            time.sleep(args.delay * (attempt + 2))
        if result == "ok":
            ok += 1
            print(f"[{i}/{len(rows)}] {sid} ok ({target.stat().st_size // 1024} KB, {len(wanted)} difficulties verified)", flush=True)
        else:
            failed += 1
            print(f"[{i}/{len(rows)}] {sid} FAILED: {result}", flush=True)
        time.sleep(args.delay)
    print(f"done: {ok} verified, {failed} failed -> {args.out}")
    return 0 if failed == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
