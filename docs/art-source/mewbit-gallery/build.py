"""Builds animacje-mewbit.html: template.html with small previews of every Mewbit frame embedded, plus bundles/<pose>.json holding the full-size frames the page loads on demand."""
import base64
import io
import json
import os
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "..", "rig2", "poses")
PREVIEW = 220


def uri(data):
    return "data:image/webp;base64," + base64.b64encode(data).decode()


previews = {}
bundles = os.path.join(HERE, "bundles")
shutil.rmtree(bundles, ignore_errors=True)
os.makedirs(bundles)
for pose in sorted(os.listdir(FRAMES)):
    previews[pose], full = {}, {}
    for name in sorted(os.listdir(os.path.join(FRAMES, pose))):
        path = os.path.join(FRAMES, pose, name)
        with open(path, "rb") as fh:
            full[name.removesuffix(".webp")] = uri(fh.read())
        small = io.BytesIO()
        Image.open(path).convert("RGBA").resize((PREVIEW, PREVIEW), Image.LANCZOS).save(small, "WEBP", quality=70, alpha_quality=70, method=4)
        previews[pose][name.removesuffix(".webp")] = uri(small.getvalue())
    with open(os.path.join(bundles, f"{pose}.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(full, fh)

with open(os.path.join(HERE, "template.html"), encoding="utf-8") as fh:
    page = fh.read()
marker = "<script>\nconst run ="
assert page.count(marker) == 1
payload = f'<script type="application/json" id="frame-data">{json.dumps(previews)}</script>\n'
page = page.replace(marker, payload + marker)

out = os.path.join(HERE, "animacje-mewbit.html")
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(page)
sizes = sum(os.path.getsize(os.path.join(bundles, f)) for f in os.listdir(bundles))
print(len(previews), "poses", sum(len(v) for v in previews.values()), "frames, page", round(os.path.getsize(out) / 1e6, 2), "MB, bundles", round(sizes / 1e6, 2), "MB")
