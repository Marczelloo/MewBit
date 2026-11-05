"""python keymap.py out.jpg x0,y0,x1,y1 name[...]: key drawings 1:1 with a 50 px source grid, to read outlines off."""
import glob
import sys

from PIL import Image, ImageDraw

from segment import SOURCE

out, box = sys.argv[1], [int(v) for v in sys.argv[2].split(",")]
names = sys.argv[3:]
w, h = box[2] - box[0], box[3] - box[1]
sheet = Image.new("RGB", (w * len(names), h), "white")
for i, name in enumerate(names):
    path = SOURCE if name == "drawing" else sorted(glob.glob(f"key-{name}-7/*.png"))[0]
    image = Image.open(path).convert("RGB").resize((768, 1152)).crop(box)
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x in range(box[0] - box[0] % 50 + 50, box[2], 50):
        d.line([(x - box[0], 0), (x - box[0], h)], fill=(0, 220, 0, 110 if x % 100 else 200))
        if x % 100 == 0:
            d.text((x - box[0] + 2, 2), str(x), fill=(255, 0, 0, 255))
    for y in range(box[1] - box[1] % 50 + 50, box[3], 50):
        d.line([(0, y - box[1]), (w, y - box[1])], fill=(0, 220, 0, 110 if y % 100 else 200))
        if y % 100 == 0:
            d.text((2, y - box[1] + 2), str(y), fill=(255, 0, 0, 255))
    d.text((30, 14), name, fill=(0, 0, 255, 255))
    sheet.paste(Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB"), (i * w, 0))
sheet.save(out, quality=88)
print(sheet.size)
