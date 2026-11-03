"""Copies the osu! wiki pages the analysis cites into data/references/ (not committed: the wiki is CC BY-NC 4.0).

    python3 -I pipeline/fetch_references.py

Source: the ppy/osu-wiki repository on GitHub (raw files), since osu.ppy.sh may be unreachable from the sandbox.
"""

import urllib.request
from pathlib import Path

PAGES = ["Ranking_criteria/osu!mania", "Ranking_criteria", "Ranking_criteria/Scaling_BPM", "Ranking_criteria/Difficulty_naming",
         "Guides/osu!mania_mapping_guide", "Beatmap/Difficulty", "Beatmap/Star_rating", "Gameplay/Kiai_time"]
BASE = "https://raw.githubusercontent.com/ppy/osu-wiki/master/wiki/{}/en.md"
OUT = Path(__file__).resolve().parents[1] / "data" / "references"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for page in PAGES:
        name = page.replace("/", "_").replace("!", "_") + ".md"
        with urllib.request.urlopen(BASE.format(page), timeout=30) as r:
            (OUT / name).write_bytes(r.read())
        print(page, "->", OUT / name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
