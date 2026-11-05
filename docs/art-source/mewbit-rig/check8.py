import sys

from PIL import Image, ImageDraw

box = (195, 280, 300, 405)
z = 3
frames = [int(f) for f in sys.argv[1:]] or [1, 14, 30, 46]
s = Image.new("RGB", (len(frames) * ((box[2] - box[0]) * z + 4), (box[3] - box[1]) * z), (255, 0, 255))
for i, f in enumerate(frames):
    bg = Image.new("RGBA", (640, 640), (40, 160, 90, 255))
    bg.alpha_composite(Image.open(f"out/{f:02d}.webp").convert("RGBA"))
    t = bg.crop(box).resize(((box[2] - box[0]) * z, (box[3] - box[1]) * z), Image.LANCZOS).convert("RGB")
    ImageDraw.Draw(t).text((3, 2), str(f), fill=(255, 255, 0))
    s.paste(t, (i * (t.width + 4), 0))
s.save("check8.jpg", quality=86)
print(s.size)
