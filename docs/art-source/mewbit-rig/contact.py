"""python contact.py out.jpg cell columns pose:1,5,9 [pose:...]: frames in reading order on grey, wrapped to `columns`, each stamped with its pose and number."""
import os
import sys

from PIL import Image, ImageDraw


def main():
    out, cell, columns = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    items = [(pose, int(n)) for pose, numbers in (a.split(":") for a in sys.argv[4:]) for n in numbers.split(",")]
    rows = (len(items) + columns - 1) // columns
    sheet = Image.new("RGB", (cell * columns, cell * rows), (92, 94, 110))
    draw = ImageDraw.Draw(sheet)
    for i, (pose, number) in enumerate(items):
        x, y = (i % columns) * cell, (i // columns) * cell
        frame = Image.open(os.path.join("poses", pose, f"{number:02d}.webp")).convert("RGBA").resize((cell, cell), Image.LANCZOS)
        sheet.paste(frame, (x, y), frame)
        draw.text((x + 3, y + 2), f"{pose} {number}", fill=(255, 255, 255))
    sheet.save(out, quality=86)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
