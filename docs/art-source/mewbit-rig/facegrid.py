"""The candidate faces side by side, only the part of the crop that holds eyes and mouth."""
import glob

from PIL import Image

names = ["face-happy-7", "face-happy-11", "face-happy-23", "face-wince-7", "face-wince-11", "face-wince-23"]
sheet = Image.new("RGB", (3 * 260, 2 * 200), "white")
for i, name in enumerate(names):
    image = Image.open(glob.glob(f"{name}/*.png")[0]).convert("RGB")
    w, h = image.size
    crop = image.crop((int(w * 0.1), int(h * 0.2), int(w * 0.9), int(h * 0.82))).resize((260, 200), Image.LANCZOS)
    sheet.paste(crop, ((i % 3) * 260, (i // 3) * 200))
sheet.save("faces2.jpg", quality=88)
