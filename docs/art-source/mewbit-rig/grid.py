"""python grid.py out.jpg cell pose:1,5,9 [pose:...]: one row per pose of rendered frames on grey, to look at few pixels at once."""
import os
import sys

from PIL import Image


def main():
    out, cell = sys.argv[1], int(sys.argv[2])
    rows = [(a.split(":")[0], [int(v) for v in a.split(":")[1].split(",")]) for a in sys.argv[3:]]
    width = max(len(frames) for _, frames in rows) * cell
    sheet = Image.new("RGB", (width, len(rows) * cell), (92, 94, 110))
    for r, (pose, frames) in enumerate(rows):
        for c, number in enumerate(frames):
            path = os.path.join("poses", pose, f"{number:02d}.webp")
            frame = Image.open(path).convert("RGBA").resize((cell, cell), Image.LANCZOS)
            sheet.paste(frame, (c * cell, r * cell), frame)
    sheet.save(out, quality=85)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
