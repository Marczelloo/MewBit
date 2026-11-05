"""python crops.py out.jpg cell x0,y0,x1,y1 pose:n [pose:n ...]: the same game-pixel window of several frames, side by side on grey."""
import os
import sys

from PIL import Image


def main():
    out, cell = sys.argv[1], int(sys.argv[2])
    box = tuple(int(v) for v in sys.argv[3].split(","))
    items = [a.split(":") for a in sys.argv[4:]]
    height = round(cell * (box[3] - box[1]) / (box[2] - box[0]))
    sheet = Image.new("RGB", (cell * len(items), height), (92, 94, 110))
    for i, (pose, number) in enumerate(items):
        frame = Image.open(os.path.join("poses", pose, f"{int(number):02d}.webp")).convert("RGBA").crop(box).resize((cell, height), Image.LANCZOS)
        sheet.paste(frame, (i * cell, 0), frame)
    sheet.save(out, quality=88)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
