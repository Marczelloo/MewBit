"""One-time refactor of rig.py: motion becomes data (the object M) so every animation can share the bones."""
import re

src = open("rig.py", encoding="utf-8").read()

start = src.index("# Amplitudes in pixels of the 768x1152 source")
end = src.index("HIP_PIVOT = (365, 490)")
src = src[:start] + src[end:]

start = src.index("def pulse(t):")
end = src.index("def rotate(p, degrees, pivot):")
src = src[:start] + src[end:]

start = src.index("def hip(p, t):")
end = src.index("def lerp(a, b, w):")
src = src[:start] + '''def root(q, t):
    """The whole figure: a lean about the planted feet and a hop."""
    return offset(rotate(q, M.lean(t), FEET), M.root_x(t), -M.lift(t))


def hip(p, t):
    q = rotate(p, M.hip_tilt(t), HIP_PIVOT)
    return root(offset(q, M.hip_x(t), M.hip_drop(t)), t)


def chest(p, t):
    t = t - 0.008 * M.lag
    return hip(offset(rotate(p, M.chest_tilt(t), CHEST_PIVOT), 0 * p[..., 0], M.slump(t)), t)


def head(p, t):
    bob = t - 0.012 * M.lag
    q = rotate(p, M.head_tilt(t - 0.03 * M.lag) + M.head_bob(bob), HEAD_PIVOT)
    q = offset(q, M.head_x(bob), M.nod(bob))
    # Looking down foreshortens the face about the neck.
    q[..., 1] = HEAD_PIVOT[1] + (q[..., 1] - HEAD_PIVOT[1]) * (1 - M.head_squash(bob))
    return chest(q, t)


''' + src[end:]

start = src.index("def bone_body(p, t):")
end = src.index("def eye_timeline():")
src = src[:start] + '''def bone_body(p, t):
    """Chest down to the belly, hips through the shorts, then the legs give way to the planted boots."""
    y = p[..., 1]
    q = lerp(chest(p, t), hip(p, t), smoothstep(y, 420, 485))
    u = np.clip((y - 590) / (1070 - 590), 0, 1)
    q = lerp(q, root(p, t), u)
    q[..., 0] += np.tanh((p[..., 0] - HIP_PIVOT[0]) / 40) * M.knee(t) * np.sin(np.pi * u)
    return q


def bone_jacket(p, t):
    """Shoulders ride the chest, sleeves trail behind them, and the hand on the hip stays on the hip."""
    w = smoothstep(p[..., 1], 340, 560)
    lag = t - 0.035 * M.lag * w
    swing = M.arm_swing(lag - 0.02 * M.lag) * w
    left = rotate(p, swing, SHOULDER_L)
    right = rotate(p, swing, SHOULDER_R)
    swung = chest(lerp(left, right, smoothstep(p[..., 0], 330, 410)), lag)
    q = lerp(chest(p, t), swung, w)
    d2 = (p[..., 0] - HAND_ON_HIP[0]) ** 2 + (p[..., 1] - HAND_ON_HIP[1]) ** 2
    q = lerp(q, hip(p, t), np.exp(-d2 / (2 * 55.0 ** 2)))
    return lerp(q, hip(p, lag), smoothstep(p[..., 1], 560, 650))


def bone_arm(p, t):
    """The jacket's own motion, plus a sleeve that bends from the elbow's crease and a hand loose at the wrist."""
    dx, dy = WRIST[0] - ELBOW[0], WRIST[1] - ELBOW[1]
    length = np.hypot(dx, dy)
    along = ((p[..., 0] - ELBOW[0]) * dx + (p[..., 1] - ELBOW[1]) * dy) / length
    hand = M.hand(t - 0.09 * M.lag) * smoothstep(p[..., 1], 574, 592)
    sleeve = M.sleeve(t - 0.05 * M.lag) * smoothstep(along, 0, 50)
    return bone_jacket(rotate(rotate(p, hand, WRIST), sleeve, ELBOW), t)


def bone_head(p, t):
    """Rigid head above the jaw; below it the hair lags and swings, heavier toward the tips."""
    s = np.clip((p[..., 1] - JAW_Y) / (HAIR_TIPS_Y - JAW_Y), 0, 1)
    lag = t - 0.06 * M.lag * s
    q = lerp(head(p, lag), chest(p, lag), 0.9 * smoothstep(s, 0, 0.7))
    q[..., 0] += M.hair_x(t - 0.075 * M.lag) * s * s
    q[..., 1] += M.hair_y(t - 0.05 * M.lag) * s * s
    return q


def bone_key(p, t):
    """A key drawing's arms: each turns about its shoulder, the hand a little later, and the seam at the shoulder stays put."""
    q = p
    for pivot, direction, length, angle, sign in M.limbs:
        dx, dy = p[..., 0] - pivot[0], p[..., 1] - pivot[1]
        along = dx * direction[0] + dy * direction[1]
        across = np.abs(dx * direction[1] - dy * direction[0])
        w = smoothstep(along, 15, 85) * (1 - smoothstep(across, 95, 150))
        q = lerp(q, rotate(q, sign * angle(t - 0.03 * M.lag * np.clip(along / length, 0, 1)), pivot), w)
    return bone_jacket(q, t)


''' + src[end:]

# Eye timeline moves to anims.py; the layer code stays.
start = src.index("def eye_timeline():")
end = src.index("def premultiply(rgb, alpha):")
src = src[:start] + src[end:]

src = src.replace('''def warp(layer, bone, t):
    """Mesh warp through PIL: each target cell samples the source quad found by inverting the bone with two steps."""
    ys, xs = np.nonzero(layer[..., 3] > 0.002)
    x0 = max(int(xs.min()) - 45, 0)
    x1 = min(int(xs.max()) + 45, layer.shape[1])
    y0 = max(int(ys.min()) - 45, 0)
    y1 = min(int(ys.max()) + 45, layer.shape[0])
    gx = np.arange(x0, x1 + GRID, GRID, dtype=np.float64)
    gy = np.arange(y0, y1 + GRID, GRID, dtype=np.float64)
    q = np.stack(np.meshgrid(gx, gy), -1)
    p = q - (bone(q, t) - q)
    p = q - (bone(p, t) - p)
    image = Image.frombytes("RGBa", (layer.shape[1], layer.shape[0]), (layer * 255 + 0.5).astype(np.uint8).tobytes())
    mesh = []
    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            box = (int(gx[i]), int(gy[j]), int(gx[i + 1]), int(gy[j + 1]))
            quad = (*p[j, i], *p[j + 1, i], *p[j + 1, i + 1], *p[j, i + 1])
            mesh.append((box, tuple(float(v) for v in quad)))
    out = image.transform(image.size, Image.MESH, mesh, resample=Image.BICUBIC)
    return np.frombuffer(out.tobytes(), np.uint8).reshape(layer.shape).astype(np.float32) / 255
''', '''def warp(layer, bone, t, margin=45, steps=2):
    """Mesh warp through PIL: each target cell samples the source quad found by inverting the bone. The target has PAD around the drawing."""
    ys, xs = np.nonzero(layer[..., 3] > 0.002)
    h, w = layer.shape[:2]
    x0 = max(int(xs.min()) - margin, -PAD[0])
    x1 = min(int(xs.max()) + margin, w + PAD[0])
    y0 = max(int(ys.min()) - margin, -PAD[1])
    y1 = min(int(ys.max()) + margin, h)
    gx = np.arange(x0, x1 + GRID, GRID, dtype=np.float64)
    gy = np.arange(y0, y1 + GRID, GRID, dtype=np.float64)
    q = np.stack(np.meshgrid(gx, gy), -1)
    p = q
    for _ in range(steps):
        p = q - (bone(p, t) - p)
    image = Image.frombytes("RGBa", (w, h), (layer * 255 + 0.5).astype(np.uint8).tobytes())
    size = (w + 2 * PAD[0], h + PAD[1])
    mesh = []
    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            box = (int(gx[i]) + PAD[0], int(gy[j]) + PAD[1], int(gx[i + 1]) + PAD[0], int(gy[j + 1]) + PAD[1])
            if box[0] < 0 or box[1] < 0 or box[2] > size[0] or box[3] > size[1]:
                continue
            quad = (*p[j, i], *p[j + 1, i], *p[j + 1, i + 1], *p[j, i + 1])
            mesh.append((box, tuple(float(v) for v in quad)))
    out = image.transform(size, Image.MESH, mesh, resample=Image.BICUBIC)
    return np.frombuffer(out.tobytes(), np.uint8).reshape((size[1], size[0], 4)).astype(np.float32) / 255
''')

src = src.replace('''    frame.paste(small, (round(OUT_SIZE / 2 - CENTER_X * scale), round(OUT_FEET_Y - FEET_Y * scale)))
    return frame
''', '''    frame.paste(small, (round(OUT_SIZE / 2 - (CENTER_X + PAD[0]) * scale), round(OUT_FEET_Y - (FEET_Y + PAD[1]) * scale)))
    return frame
''')

# main() moves to render.py.
src = src[: src.index("def main():")].rstrip() + "\n"
src = src.replace('import sys\n\n', '\n')
src = src.replace('''FRAMES = 64
BEATS = 4
SWAYS = 2
OUT_SIZE = 640''', '''OUT_SIZE = 640''')
src = src.replace('''HIP_PIVOT = (365, 490)''', '''# Room around the drawing for raised arms and hops: game frames reach this far past the 768x1152 source.
PAD = (284, 184)
FEET = (383.5, 1126)
# The animation being rendered; see anims.py.
M = None

HIP_PIVOT = (365, 490)''')
open("rig.py", "w", encoding="utf-8", newline="\n").write(src)
print(re.findall(r"HIP_SWAY|HIP_DROP|BEATS|SWAYS|FRAMES\b|sway\(|pulse\(", src))
