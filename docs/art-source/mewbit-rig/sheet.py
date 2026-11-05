"""Small contact sheet of key drawings: python sheet.py name [name...] writes sheet.jpg."""
import glob
import sys

from PIL import Image, ImageDraw

names = sys.argv[1:]
H = 480
W = H * 2 // 3
s = Image.new("RGB", (len(names) * (W + 4), H), (255, 0, 255))
for i, n in enumerate(names):
    t = Image.open(sorted(glob.glob(f"{n}/*.png"))[0]).convert("RGB").resize((W, H), Image.LANCZOS)
    ImageDraw.Draw(t).text((3, 2), n, fill=(255, 0, 120))
    s.paste(t, (i * (W + 4), 0))
s.save("sheet.jpg", quality=84)
print(s.size)
