"""Per-level note files from shared/cross/, so a level's analysis can read its charts without the other levels'.

    python3 -I pipeline/split_notes.py [--shared shared]

Writes shared/data/<level>/notes/human_<set>.json and algo_<set>.json: {"set_id", "level", "source", "timeline",
"notes": [[t_ms, lane, end_ms_or_null], ...]}. Times are on the decoded audio's timeline (human maps were shifted by
the song's timeline_offset; see shared/metrics.md, "Oś czasu").
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    args = ap.parse_args(argv)
    count = 0
    for p in sorted((args.shared / "cross").glob("*.json")):
        cross = json.loads(p.read_text())
        for source in ("human", "algo"):
            for level, notes in cross.get(source, {}).items():
                out = args.shared / "data" / level / "notes" / f"{source}_{cross['set_id']}.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps({"set_id": cross["set_id"], "level": level, "source": source,
                                           "timeline": "audio", "notes": notes}))
                count += 1
    print(f"{count} note files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
