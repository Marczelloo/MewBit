"""Builds a synthetic beatmapset for the pipeline smoke test (no real map data).

    python3 -I make_smoke_osz.py <audio file> <out dir>

Writes <out dir>/maps/999999 Smoke - Test.osz with three 4K mania difficulties on a 120 BPM grid at offset 0
(matching the synthetic audio of the smoke test) and <out dir>/corpus.csv naming them, split "test".
"""

import sys
import zipfile
from pathlib import Path

HEAD = """osu file format v14

[General]
AudioFilename: audio.ogg
AudioLeadIn: 0
PreviewTime: 30000
Mode: 3

[Metadata]
Title:Smoke
Artist:Test
Creator:pipeline
Version:{version}
Source:
Tags:smoke
BeatmapID:{bid}
BeatmapSetID:999999

[Difficulty]
HPDrainRate:7
CircleSize:4
OverallDifficulty:7
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Events]

[TimingPoints]
0,500,4,2,0,40,1,0
48000,-100,4,2,0,40,0,1
64000,-100,4,2,0,40,0,0

[HitObjects]
"""

X = {0: 64, 1: 192, 2: 320, 3: 448}


def note(t, lane, end=None):
    if end:
        return f"{X[lane]},192,{t},128,0,{end}:0:0:0:0:"
    return f"{X[lane]},192,{t},1,0,0:0:0:0:"


def diff(level: str) -> list[str]:
    out = []
    for beat in range(4, 170):
        t = beat * 500
        bar_pos = beat % 4
        if level == "easy":
            if beat % 2 == 0:
                out.append(note(t, (beat // 2) % 4))
        elif level == "normal":
            out.append(note(t, [0, 2, 1, 3][bar_pos]))
            if bar_pos == 3:
                out.append(note(t + 250, 2))
        else:
            if bar_pos == 0:
                out.append(note(t, 0))
                out.append(note(t, 3))
            elif bar_pos == 2 and beat % 8 == 2:
                out.append(note(t, 1, t + 750))
            else:
                out.append(note(t, [0, 1, 2, 3][bar_pos]))
            out.append(note(t + 250, [2, 3, 0, 1][bar_pos]))
    return out


def main():
    audio, out = Path(sys.argv[1]), Path(sys.argv[2])
    (out / "maps").mkdir(parents=True, exist_ok=True)
    osz = out / "maps" / "999999 Smoke - Test.osz"
    with zipfile.ZipFile(osz, "w") as z:
        z.write(audio, "audio.ogg")
        for i, level in enumerate(("easy", "normal", "hard")):
            z.writestr(f"Test - Smoke (pipeline) [{level}].osu", HEAD.format(version=level, bid=9990001 + i) + "\n".join(diff(level)) + "\n")
    rows = ["set_id,split,genre,easy_beatmap_id,easy_version,easy_stars,normal_beatmap_id,normal_version,normal_stars,hard_beatmap_id,hard_version,hard_stars",
            "999999,test,electronic,9990001,easy,1.5,9990002,normal,2.3,9990003,hard,3.2"]
    (out / "corpus.csv").write_text("\n".join(rows) + "\n")
    print(osz)


if __name__ == "__main__":
    main()
