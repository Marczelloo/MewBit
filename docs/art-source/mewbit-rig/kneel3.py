"""She drops to her knees, drawn from the drawing's own layers only: the body above the thighs travels down whole, the shins turn away behind the knees, the boots stay on the floor and pass behind them, and after the knees land she sinks back onto her heels."""
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator

import rig
import render
from anims import Anim, track
from arms import back_map
from kneel import pained
from render import LIMB_MARGIN, drop_specks, pick, pose_of, two_armed
from rig import FEET, PAD, bone_arm, bone_chest, bone_head, bone_jacket, compose, smooth, smoothstep, to_game, warp

FRAMES = 28
EYES = ["open", "lid1", "lid2"] + ["wince"] * 21 + ["sad"] * 4
SIZE = 1336
HIP_ROW, KNEE_ROW, CUFF_ROW = 600, 790, 948
# Where the legs are in the drawing and where they kneel: knees and boots meet, as things further off draw closer to the middle.
LEGS = {
    "L": dict(floor=1118, sole=1116, knee=314, top=302, boot=287, knee_to=302, boot_to=299, lead=0.5),
    "R": dict(floor=1126, sole=1125, knee=474, top=506, boot=518, knee_to=494, boot_to=494, lead=-0.5),
}
BOOT_LIFT, BOOT_FLAT, BOOT_NARROW = 22, 0.28, 0.15
CAP_DEPTH, CAP_START, CAP_INK = 24, 50, 6.5
INK = np.array([0.10, 0.085, 0.11], np.float32)
BLEND = (340, 395)


def curve(*points):
    xs, ys = zip(*points)
    spline = PchipInterpolator(xs, ys)
    return lambda f: float(spline(np.clip(f, xs[0], xs[-1])))


# The knees' way down as a share of the whole: under way by frame 2, fastest around 9, and braking into the floor at 15.
KNEES = curve((0, 0), (1, 0.002), (2, 0.012), (4, 0.075), (6, 0.19), (8, 0.36), (10, 0.565), (12, 0.76), (14, 0.93), (15, 0.975), (16, 1), (27, 1))
# The hips carry on after the knees stop: the thighs turn towards us as she sits back.
SIT = curve((0, 0), (8, 0), (11, 6), (14, 20), (16, 36), (18, 54), (20, 66), (22, 71), (24, 70), (27, 68))
SWAY = curve((0, 0), (4, -3), (9, -5), (14, 2), (18, 5), (22, 3), (27, 3))
# Cloth behind the fall, then running on past the landing.
CLOTH = curve((0, 0), (5, -3), (9, -13), (13, -14), (16, -2), (18, 7), (21, 5), (24, 1), (27, 2))


def anim():
    n = FRAMES
    a = Anim(
        n, 24, loop=False,
        slump=track(n, (0, 0), (3, 2), (12, 3), (17, 17), (20, 13), (27, 15)),
        nod=track(n, (0, 0), (2, -3), (7, -7), (12, -2), (17, 21), (20, 16), (27, 19)),
        head_squash=track(n, (0, 0), (12, 0.008), (17, 0.07), (27, 0.065)),
        head_tilt=track(n, (0, 0), (3, 2), (10, 1.5), (17, -3), (27, -2.5)),
        hair_x=track(n, (0, 0), (5, 8), (11, -8), (18, 5), (23, -1), (27, 0)),
        hair_y=track(n, (0, 0), (4, -2), (8, -16), (12, -24), (16, -4), (19, 12), (23, 5), (27, 7)),
        series=((None, 0), ("both_down", 1)), elev=track(n, (0, 0), (2, 0.05), (7, 1), (27, 1)),
        wob_l=track(n, (0, 0), (7, -4), (12, -6), (17, 4), (22, -1), (27, 0)), wob_r=track(n, (0, 0), (7, -6), (12, -7), (17, 4), (22, -1), (27, 0)),
    )
    a.eyes = EYES
    return a


def leg_state(side, f):
    leg = LEGS[side]
    k = KNEES(f + leg["lead"])
    e = float(smooth(k))
    knee_row = KNEE_ROW + k * (leg["floor"] - KNEE_ROW)
    sole = leg["sole"] - BOOT_LIFT * e
    flat = 1 - BOOT_FLAT * e
    narrow = 1 - BOOT_NARROW * e
    boot_x = leg["boot"] + e * (leg["boot_to"] - leg["boot"])
    cuff_row = sole - (leg["sole"] - CUFF_ROW) * flat
    return dict(
        k=k, knee_row=knee_row, shin=max(cuff_row + 2 - knee_row, 0.0), sole=sole, flat=flat, narrow=narrow, boot_x=boot_x,
        knee_x=leg["knee"] + e * (leg["knee_to"] - leg["knee"]), top_x=boot_x + (leg["top"] - leg["boot"]) * narrow,
    )


def rows_of(side, f, drop, slump, sway):
    """Row in the frame and sideways shift of every row of the drawing, for one leg's side."""
    s = leg_state(side, f)
    ys = np.arange(1153, dtype=np.float64)
    above = ys + drop + slump * (1 - smoothstep(ys, 360, 560))
    below = np.interp(ys, [HIP_ROW, KNEE_ROW, CUFF_ROW, 1153], [HIP_ROW + drop, s["knee_row"], s["knee_row"] + s["shin"], s["knee_row"] + s["shin"] + 205])
    row = np.where(ys < HIP_ROW, above, below) + 1e-3 * ys
    leg = LEGS[side]
    shift = np.interp(ys, [630, KNEE_ROW, CUFF_ROW], [sway, s["knee_x"] - leg["knee"], s["top_x"] - leg["top"]])
    return row, shift, s


def sample(layer, ys, xs):
    return np.stack([ndi.map_coordinates(layer[..., c], [ys, xs], order=1, mode="constant") for c in range(4)], -1)


def upper_legs(layer, f, drop, slump, sway):
    """The body above the boots. Rows are squeezed hard at the shin, so each pixel of the frame averages three rows of the drawing."""
    src = np.arange(1153, dtype=np.float64)
    row_l, shift_l, state_l = rows_of("L", f, drop, slump, sway)
    row_r, shift_r, state_r = rows_of("R", f, drop, slump, sway)
    columns = np.arange(SIZE) - PAD[0]
    weight = smoothstep(columns.astype(np.float64), *BLEND)
    out = np.zeros((SIZE, SIZE, 4), np.float32)
    for offset in (-1 / 3, 0, 1 / 3):
        rows = np.arange(SIZE) - PAD[1] + offset
        ys = np.zeros((SIZE, SIZE))
        xs = np.zeros((SIZE, SIZE))
        for c, (x, w) in enumerate(zip(columns, weight)):
            line = np.interp(rows, (1 - w) * row_l + w * row_r, src, left=-50, right=2000)
            ys[:, c] = line
            xs[:, c] = x - np.interp(line, src, (1 - w) * shift_l + w * shift_r)
        out += sample(layer, ys, xs) / 3
    return out, {"L": state_l, "R": state_r}


def cap(canvas, states):
    """Where the leg ends in front of the boot it needs an end of its own: rounded like a knee, with a line around it like the rest of her."""
    out = canvas.copy()
    rows, cols = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    rows -= PAD[1]
    cols -= PAD[0]
    for side, s in states.items():
        strength = float(smooth(1 - s["shin"] / CAP_START))
        if strength <= 0:
            continue
        here = cols < 384 if side == "L" else cols >= 384
        bottom = s["knee_row"] + s["shin"]
        top = int(bottom) + PAD[1] - 34
        span = np.nonzero((out[top:top + 6, :, 3] > 0.5).any(0) & here[0])[0] - PAD[0]
        centre, half = (span[0] + span[-1]) / 2, (span[-1] - span[0]) / 2 + 1.5
        depth = CAP_DEPTH * strength
        edge = bottom - depth * (1 - np.sqrt(1 - np.clip((cols - centre) / half, -1, 1) ** 2))
        low = here & (rows > bottom - depth - 3)
        keep = np.where(low, np.clip(edge - rows + 0.5, 0, 1), 1.0).astype(np.float32)
        out *= keep[..., None]
        band = int(bottom) + PAD[1]
        window = (slice(band - 70, band + 4), slice(int(span[0]) + PAD[0] - 8, int(span[-1]) + PAD[0] + 8))
        inside = ndi.distance_transform_edt(out[window][..., 3] > 0.5)
        line = np.clip(CAP_INK - inside, 0, 1) * strength * np.clip((rows[window] - (bottom - depth - 8)) / 4, 0, 1)
        line = line[..., None].astype(np.float32)
        out[window][..., :3] = out[window][..., :3] * (1 - line) + INK * out[window][..., 3:] * line
    return out


def boots(layer, states):
    """The boots stay on the floor. They tip away as she goes down, so they flatten a little and draw in towards each other."""
    rows, cols = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    rows -= PAD[1]
    cols -= PAD[0]
    ys = np.zeros_like(rows)
    xs = np.zeros_like(rows)
    for side, s in states.items():
        leg = LEGS[side]
        here = cols < 384 if side == "L" else cols >= 384
        ys[here] = (leg["sole"] - (s["sole"] - rows) / s["flat"])[here]
        xs[here] = (leg["boot"] + (cols - s["boot_x"]) / s["narrow"])[here]
    return sample(layer, ys, xs)


def carried(bone, f, drop, sway, cloth=False):
    """A bone with the whole fall on top. Cloth hangs back from its hem on the way down and runs on past the landing."""
    drag = CLOTH(f) if cloth else 0.0

    def moved(p, t):
        q = bone(p, t)
        q[..., 0] += sway
        q[..., 1] += drop + drag * smoothstep(p[..., 1], 430, 650)
        return q

    return moved


def frame_at(a, f, scene, upper, lower):
    a.at_frame(f)
    t = np.float64(f / a.frames)
    k = (KNEES(f + LEGS["L"]["lead"]) + KNEES(f + LEGS["R"]["lead"])) / 2
    knee_drop = k * ((LEGS["L"]["floor"] + LEGS["R"]["floor"]) / 2 - KNEE_ROW)
    drop, sway = knee_drop + SIT(f), SWAY(f)
    slump = float(a.slump(t - 0.008 * a.lag))
    legs, states = upper_legs(upper, f, drop, slump, sway)
    body = [boots(lower, states), cap(legs, states)]

    head_bone = carried(bone_head, f, drop, sway)
    jacket_bone = carried(bone_jacket, f, drop, sway, True)
    limb_bone = carried(bone_chest, f, drop, sway)
    head = warp(scene.heads[a.eyes[f]], head_bone, t, 60, 3)
    at = lambda layer, bone: warp(layer, bone, t, 60, 3)
    name = pick(a, f, scene)
    two = two_armed(a, name)
    drawn = None
    if not name and a.series:
        drawn = {side: pose_of(a, None, side, scene, t) for side in (("L", "R") if two else ("L",))}
        if all(np.abs(np.array(p) - np.array(q)).max() < 0.05 for p, q in drawn.values()):
            drawn = None
    base = scene.layers
    if not name and not drawn:
        stack = [at(base["hairBack"], head_bone), *body, at(base["hairFront"], head_bone), at(base["jacket"], jacket_bone), at(base["arm"], carried(bone_arm, f, drop, sway, True)), head]
        return compose(stack)

    clearance = scene.clearance(two)
    plate = scene.plate if two else None
    jacket = plate["jacket"] if two else base["jacket"]
    left = scene.left
    stack = [at(left["hairBack"], head_bone), *body, at(left["hairFront"], head_bone), at(left["under"], jacket_bone)]
    if two:
        stack.append(at(plate["under"], jacket_bone))
    hanging, hands = [], []
    if name:
        layers, cuts, _ = scene.key(name)
        for side, cut in cuts.items():
            src, dst = pose_of(a, name, side, scene, t)
            turn = (back_map(src, dst, None if cut.get("over") or cut.get("free") else clearance), dst)
            arm = warp(layers[f"limb{side}"], limb_bone, t, LIMB_MARGIN, 3, turn)
            (hanging if cut.get("over") else stack).append(arm)
            if f"hand{side}" in layers:
                hands.append(warp(layers[f"hand{side}"], limb_bone, t, LIMB_MARGIN, 3, turn))
        stack.append(at(jacket, jacket_bone))
        if two:
            stack.append(at(plate["panel"], jacket_bone))
    else:
        stack.append(at(jacket, jacket_bone))
        for side, (src, dst) in drawn.items():
            layer, bone = (base["arm"], carried(bone_arm, f, drop, sway, True)) if side == "L" else (plate["arm"], jacket_bone)
            stack.append(warp(layer, bone, t, LIMB_MARGIN, 3, (back_map(src, dst, clearance), dst)))
    return compose(stack + hanging + [head] + hands)


def main():
    only = [int(v) for v in sys.argv[1].split(",")] if len(sys.argv) > 1 else list(range(1, FRAMES + 1))
    scene = render.Scene()
    pained(scene)
    a = anim()
    rig.M = a
    body = scene.layers["body"]
    cut = (np.arange(body.shape[0]) < CUFF_ROW).astype(np.float32)[:, None, None]
    upper, lower = body * cut, body * (1 - cut)
    out = os.path.join("poses", "crushed")
    if len(sys.argv) <= 1:
        for old in os.listdir(out):
            os.remove(os.path.join(out, old))
    for n in only:
        image = drop_specks(to_game(np.clip(frame_at(a, n - 1, scene, upper, lower), 0, 1)))
        image.save(os.path.join(out, f"{n:02d}.webp"), quality=88, alpha_quality=95, method=6)
    print("done", len(only), flush=True)


if __name__ == "__main__":
    main()
