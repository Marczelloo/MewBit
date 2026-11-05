"""Cut the raw game frames and export them for the mewbeat Mewbit component.

Run from docs/character/anime:  python anim_export.py
Writes frames/game/<pose>/NN.png (master), frames/game-webp/<pose>/NN.webp (for the game),
frames/game-webp/poses.json (order and fps per pose) and frames/game/preview.html.
"""
import base64, glob, io, json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cutout import cut_full

RAW = "frames/raw/game"
MASTER = "frames/game"
WEBP = "frames/game-webp"
SIDE = 1060  # square master canvas: the game draws Mewbit in a square box with object-fit: cover
BASE = 1048  # y of the ground line on the master canvas
WEBP_SIDE = 640
THUMB_SIDE = 240

# order: 1-based frames as played (a loop may revisit a frame, which saves generating it).
# hold: one-shot, stays on its last frame instead of looping.
POSES = {
    "neutral": {"order": [1, 2, 1, 3], "fps": 2.5, "where": "game"},
    "vibe1": {"order": [1, 2, 3, 2], "fps": 4, "where": "game"},
    "vibe2": {"order": [1, 2, 3, 4], "fps": 6, "where": "game"},
    "vibe3": {"order": [1, 2, 3, 4], "fps": 8, "where": "game"},
    "miss": {"order": [1, 2, 3], "fps": 5, "hold": True, "where": "game"},
    "crushed": {"order": [1, 2, 3, 4], "fps": 3.4, "hold": True, "where": "game"},
    "milestone": {"order": [1, 2, 3, 4], "fps": 4.5, "hold": True, "where": "game"},
    "fever": {"order": [1, 2, 3, 4, 3, 5], "fps": 8, "where": "game"},
    "charting": {"order": [1, 2, 3, 2], "fps": 2.5, "where": "game"},
    "reveal": {"order": [1, 2, 3, 4], "fps": 4, "hold": True, "where": "unlock"},
    "stretch": {"order": [1, 2, 3, 2, 4], "fps": 2.5, "where": "lobby"},
    "adjust": {"order": [1, 2, 3], "fps": 3, "where": "lobby"},
    "peek": {"order": [1, 2, 3, 2], "fps": 3, "where": "lobby"},
    "hype": {"order": [1, 2, 3, 4], "fps": 7, "where": "lobby"},
    "go": {"order": [1, 2, 3], "fps": 5, "hold": True, "where": "lobby"},
    "cheer": {"order": [1, 2, 3, 2, 4], "fps": 5, "where": "results"},
    "okay": {"order": [1, 2, 3], "fps": 2.5, "where": "results"},
    "sad": {"order": [1, 2, 3], "fps": 2.5, "where": "results"},
    "newbest": {"order": [1, 2, 3, 4], "fps": 4, "hold": True, "where": "results"},
}

# Airborne frames keep their height above the ground line (master px); the rest stand on it.
LIFT = {
    ("milestone", 2): 70, ("milestone", 3): 90, ("fever", 5): 70,
    ("hype", 2): 30, ("hype", 4): 40, ("cheer", 2): 60, ("newbest", 2): 60,
}


# Character scale per frame relative to neutral/f1, measured from the head (scale_probe.py).
# These override the frames where the measurement was unreliable: read off the contact sheet.
with open(f"{RAW}/_scale.json") as fh:
    SCALE = json.load(fh)
SCALE.update({
    "milestone/f1": 1.06, "milestone/f2": 0.85, "milestone/f3": 0.80, "milestone/f4": 0.82,
    "fever/f1": 1.03, "fever/f2": 1.05, "fever/f3": 1.10, "fever/f4": 1.10, "fever/f5": 0.85,
    "stretch/f2": 0.91, "stretch/f3": 0.88,
    "newbest/f3": 0.85, "crushed/f3": 1.30, "crushed/f4": 1.30,
})


def foot_x(alpha):
    """Horizontal centre of the lowest part of the body, so planted feet stay put between frames."""
    ys = np.where(alpha.any(axis=1))[0]
    top, bottom = ys[0], ys[-1]
    feet = alpha[bottom - max(1, (bottom - top) // 8):bottom + 1]
    xs = np.where(feet.any(axis=0))[0]
    return (xs[0] + xs[-1]) // 2


def place(im, pose, n):
    fix = 1 / SCALE.get(f"{pose}/f{n}", 1.0)
    im = im.resize((round(im.width * fix), round(im.height * fix)), Image.LANCZOS)
    arr = np.asarray(im)[..., 3] > 128
    box = im.getbbox()
    body = im.crop(box)
    x = SIDE // 2 - (foot_x(arr) - box[0])
    y = BASE - LIFT.get((pose, n), 0) - body.height
    canvas = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    if y < 0 or x < 0 or x + body.width > SIDE:
        print(f"  ! {pose} f{n} clipped by the canvas: x={x} y={y} size={body.size}")
    canvas.paste(body, (x, y))
    return canvas


def to_webp(im, side, quality):
    buf = io.BytesIO()
    im.resize((side, side), Image.LANCZOS).save(buf, "WEBP", quality=quality, alpha_quality=90, method=6)
    return buf.getvalue()


def main():
    thumbs, total = {}, 0
    for pose, cfg in POSES.items():
        os.makedirs(f"{MASTER}/{pose}", exist_ok=True)
        os.makedirs(f"{WEBP}/{pose}", exist_ok=True)
        frames = {}
        for n in sorted(set(cfg["order"])):
            src = glob.glob(f"{RAW}/{pose}/f{n}/*.png")
            if not src:
                print(f"  ! missing {pose} f{n}")
                continue
            im = place(cut_full(sorted(src)[0]), pose, n)
            im.save(f"{MASTER}/{pose}/{n:02d}.png", optimize=True)
            data = to_webp(im, WEBP_SIDE, 84)
            total += len(data)
            with open(f"{WEBP}/{pose}/{n:02d}.webp", "wb") as fh:
                fh.write(data)
            frames[n] = base64.b64encode(to_webp(im, THUMB_SIDE, 70)).decode()
        thumbs[pose] = frames
        print(pose, sorted(frames))
    print(f"webp total: {total / 1024 / 1024:.1f} MB")
    with open(f"{WEBP}/poses.json", "w") as fh:
        json.dump(POSES, fh, indent=2)
    build_preview(thumbs)


def build_preview(thumbs):
    data = {
        p: {**POSES[p], "src": ["data:image/webp;base64," + thumbs[p][n] for n in POSES[p]["order"] if n in thumbs[p]]}
        for p in POSES
    }
    page = PAGE.replace("__DATA__", json.dumps(data))
    with open(f"{MASTER}/preview.html", "w", encoding="utf-8") as fh:
        fh.write(page)


PAGE = """<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Animacje Mewbit</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--bg:#0b0a14;--card:#15131f;--text:#f4f6f9;--muted:#9ba4b2}
body{margin:0;padding:16px;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}
h2{margin:20px 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.card{background:var(--card);border-radius:12px;padding:8px;text-align:center}
img{width:100%;aspect-ratio:1;display:block}small{color:var(--muted)}
</style></head><body><div id="root"></div><script>
const D=__DATA__,root=document.getElementById('root');
for(const w of ['game','lobby','results','unlock']){
  const h=document.createElement('h2');h.textContent=w;root.append(h);
  const g=document.createElement('div');g.className='grid';root.append(g);
  for(const [n,p] of Object.entries(D).filter(([,p])=>p.where===w)){
    const c=document.createElement('div');c.className='card';
    const i=document.createElement('img');i.alt=n;i.src=p.src[0];
    const t=document.createElement('div');t.innerHTML='<b>'+n+'</b> <small>'+p.fps+' fps'+(p.hold?' · raz':'')+'</small>';
    c.append(i,t);g.append(c);
    const len=p.src.length;let k=0;
    setInterval(()=>{k+=1;if(p.hold){if(k>=len+6)k=0;i.src=p.src[Math.min(k,len-1)];}else{k%=len;i.src=p.src[k];}},1000/p.fps);
  }
}
</script></body></html>
"""

if __name__ == "__main__":
    main()
