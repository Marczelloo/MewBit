"""python keygrid.py out.jpg cell x0,y0,x1,y1 name[...]: raw key drawings on a labelled 100 px source grid; name "drawing" is bp-30."""
import glob
import sys

from PIL import Image, ImageDraw

from segment import SOURCE

out, cell, box = sys.argv[1], int(sys.argv[2]), [int(v) for v in sys.argv[3].split(",")]
names = sys.argv[4:]
w, h = box[2] - box[0], box[3] - box[1]
scale = cell / w
columns = min(6, len(names))
rows = (len(names) + columns - 1) // columns
sheet = Image.new("RGB", (cell * columns, round(h * scale) * rows), "white")
for i, name in enumerate(names):
    path = SOURCE if name == "drawing" else sorted(glob.glob(f"key-{name}-7/*.png"))[0]
    image = Image.open(path).convert("RGB").resize((768, 1152)).crop(box).resize((cell, round(h * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(image)
    for x in range(box[0] - box[0] % 100 + 100, box[2], 100):
        d.line([((x - box[0]) * scale, 0), ((x - box[0]) * scale, image.height)], fill=(0, 200, 0))
        d.text(((x - box[0]) * scale + 2, 12), str(x), fill=(0, 120, 0))
    for y in range(box[1] - box[1] % 100 + 100, box[3], 100):
        d.line([(0, (y - box[1]) * scale), (image.width, (y - box[1]) * scale)], fill=(0, 200, 0))
        d.text((2, (y - box[1]) * scale + 2), str(y), fill=(0, 120, 0))
    d.text((3, 1), name, fill=(220, 0, 0))
    sheet.paste(image, ((i % columns) * cell, (i // columns) * round(h * scale)))
sheet.save(out, quality=82)
print(out, sheet.size)
