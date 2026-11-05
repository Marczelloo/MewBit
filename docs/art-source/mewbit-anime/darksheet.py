import glob, json, math
from PIL import Image, ImageDraw
poses = json.load(open("frames/game-webp/poses.json"))
files = [f for p in poses for f in sorted(glob.glob(f"frames/game/{p}/*.png"))]
T, C = 150, 10
sheet = Image.new("RGB", (T * C, T * math.ceil(len(files) / C)), (24, 22, 36))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).resize((T, T), Image.LANCZOS)
    x, y = i % C * T, i // C * T
    sheet.paste(im, (x, y), im)
    d.text((x + 3, y + 2), f.replace("\\", "/").split("/")[-2] + " " + f[-6:-4], fill=(150, 230, 240))
sheet.save("frames/game/sheet.jpg", quality=82)
print(sheet.size, len(files))
