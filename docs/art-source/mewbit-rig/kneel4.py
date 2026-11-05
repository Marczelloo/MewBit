"""She sinks down into a floor sit: the same fall as kneel3, but each leg is a thigh and a shin with its boot, joined at the knee. The knees come in and down, the shins swing out from behind them and the boots slide out along the floor."""
import os
import sys

import numpy as np

import kneel3
import rig
import render
from kneel import pained
from anims import Anim, track
from kneel3 import BLEND, FRAMES, INK, KNEE_ROW, PAD, SIZE, curve, frame_at, sample, smooth
from render import drop_specks
from rig import to_game

# Drawing: knee and sole centre of each leg. Sit: where they end up.
LEGS = {
    "L": dict(floor=1118, knee=314, knee_to=262, sole=(287.0, 1116.0), sole_to=(44.0, 1092.0), lead=0.5),
    "R": dict(floor=1120, knee=474, knee_to=526, sole=(518.0, 1125.0), sole_to=(730.0, 1094.0), lead=-0.5),
}
CUFF_U = 160.0  # Length of the shin along the leg, in the drawing.
BOOT_SCALE = 0.86
PIVOT_UP = 34.0  # The shin leaves the knee this far above the knee's end.
SHIN_MIN = 8.0
HALF_BOOT = 46.0
SHIN_OVERLAP = 34
CAP_DEPTH, CAP_INK = 26, 6.5
SPREAD = curve((0, 0), (0.08, 0.1), (0.3, 0.35), (0.6, 0.65), (0.85, 0.84), (1, 0.9))
# The whole fall, about a quarter quicker than kneel3: the feet slip first and she is down by frame 12.
FAST_EYES = ["open", "lid1", "lid2"] + ["wince"] * 17 + ["sad"] * 8
KNEES = curve((0, 0), (1, 0.006), (2, 0.03), (3, 0.09), (4, 0.18), (5, 0.3), (6, 0.44), (7, 0.59), (8, 0.73), (9, 0.85), (10, 0.94), (11, 0.985), (12, 1), (27, 1))
SIT = curve((0, 0), (6, 0), (8, 6), (10, 20), (12, 38), (14, 56), (15, 63), (17, 71), (19, 70), (27, 68))
SWAY = curve((0, 0), (3, -3), (7, -5), (10, 2), (14, 5), (17, 3), (27, 3))
CLOTH = curve((0, 0), (4, -3), (7, -14), (10, -15), (12, -2), (14, 8), (16, 5), (18, 1), (27, 2))


def fast_anim():
    n = FRAMES
    a = Anim(
        n, 24, loop=False,
        slump=track(n, (0, 0), (2, 2), (9, 3), (13, 17), (15, 13), (27, 15)),
        nod=track(n, (0, 0), (2, -3), (5, -7), (9, -2), (13, 21), (15, 16), (27, 19)),
        head_squash=track(n, (0, 0), (9, 0.008), (13, 0.07), (27, 0.065)),
        head_tilt=track(n, (0, 0), (2, 2), (8, 1.5), (13, -3), (27, -2.5)),
        hair_x=track(n, (0, 0), (4, 8), (8, -8), (14, 5), (18, -1), (27, 0)),
        hair_y=track(n, (0, 0), (3, -2), (6, -16), (9, -24), (12, -4), (15, 12), (18, 5), (27, 7)),
        series=((None, 0), ("both_down", 1)), elev=track(n, (0, 0), (2, 0.05), (6, 1), (27, 1)),
        wob_l=track(n, (0, 0), (5, -4), (9, -6), (13, 4), (17, -1), (27, 0)), wob_r=track(n, (0, 0), (5, -6), (9, -7), (13, 4), (17, -1), (27, 0)),
    )
    a.eyes = FAST_EYES
    return a


def leg_state(side, f):
    leg = LEGS[side]
    k = KNEES(f + leg["lead"])
    e = float(smooth(k))
    sit = SIT(f) / 70
    knee_row = KNEE_ROW + k * (leg["floor"] - KNEE_ROW)
    knee_x = leg["knee"] + e * (leg["knee_to"] - leg["knee"])
    w = SPREAD(k) + 0.1 * float(smooth(sit))
    s0, s1 = np.array(leg["sole"]), np.array(leg["sole_to"])
    k0 = np.array([leg["knee"], KNEE_ROW], float)
    pivot = np.array([knee_x, knee_row - PIVOT_UP * float(smooth(min(k / 0.3, 1))) - 36 * float(smooth(max(k - 0.6, 0) / 0.4))])
    # The sole stays on the floor: it only comes up by as much as the turned boot's side goes down.
    sole_x = s0[0] + w * (s1[0] - s0[0])
    sole_y = s0[1]
    for _ in range(3):
        turn = (sole_x - pivot[0]) / np.hypot(sole_x - pivot[0], sole_y - pivot[1])
        sole_y = s0[1] - (s0[1] - s1[1]) * abs(turn) ** 3
    sole = np.array([sole_x, sole_y])
    length0 = np.linalg.norm(s0 - k0)
    boot_len = (length0 - CUFF_U) * (1 - (1 - BOOT_SCALE) * e)
    # What is left above the boot: the shin turns away from us. Once it is gone the boot passes behind the knee.
    axis = sole - pivot
    length = np.linalg.norm(axis)
    return dict(k=k, e=e, knee_row=knee_row, knee_x=knee_x, shin=0.0, pivot=pivot, axis=(sole - pivot) / length, length=length, boot_len=boot_len,
                k0=k0, a0=(s0 - k0) / length0, length0=length0, sole=sole, top_x=knee_x)


def rows_of(side, f, drop, slump, sway):
    """Row in the frame and sideways shift of every row of the drawing, down to the knee."""
    s = leg_state(side, f)
    ys = np.arange(1153, dtype=np.float64)
    above = ys + drop + slump * (1 - rig.smoothstep(ys, 360, 560))
    below = np.interp(ys, [kneel3.HIP_ROW, KNEE_ROW, 1153], [kneel3.HIP_ROW + drop, s["knee_row"], s["knee_row"] + 363])
    row = np.where(ys < kneel3.HIP_ROW, above, below) + 1e-3 * ys
    leg = LEGS[side]
    shift = np.interp(ys, [630, KNEE_ROW], [sway, s["knee_x"] - leg["knee"]])
    return row, shift, s


def cap(canvas, states):
    """The thigh ends in a rounded knee with a line around it."""
    out = canvas.copy()
    rows, cols = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    rows -= PAD[1]
    cols -= PAD[0]
    from scipy import ndimage as ndi
    for side, s in states.items():
        strength = float(smooth(np.clip((s["k"] - 0.04) / 0.26, 0, 1)))
        if strength <= 0:
            continue
        here = cols < 384 if side == "L" else cols >= 384
        bottom = s["knee_row"]
        top = int(bottom) + PAD[1] - 26
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


def shin(layer, side, s):
    """Shin and boot as one piece, turned about the knee. The shin takes up the shortening along the leg: the boot only gets a little smaller."""
    rows, cols = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    rows -= PAD[1]
    cols -= PAD[0]
    a, n = s["axis"], np.array([-s["axis"][1], s["axis"][0]])
    a0, n0 = s["a0"], np.array([-s["a0"][1], s["a0"][0]])
    du = (cols - s["pivot"][0]) * a[0] + (rows - s["pivot"][1]) * a[1]
    dv = (cols - s["pivot"][0]) * n[0] + (rows - s["pivot"][1]) * n[1]
    scale = s["boot_len"] / (s["length0"] - CUFF_U)
    cuff = s["length"] - s["boot_len"]
    start = min(0.0, cuff - SHIN_MIN)
    knots_d = [start - 300.0, start, cuff, s["length"], s["length"] + 300 * scale]
    knots_s = [-300.0, 0.0, CUFF_U, s["length0"], s["length0"] + 300]
    out = 0
    for offset in (-1 / 3, 0, 1 / 3):
        us = np.interp(du + offset, knots_d, knots_s)
        width = np.interp(du + offset, knots_d[1:3], [1.0, scale])
        vs = dv / width
        ys = s["k0"][1] + us * a0[1] + vs * n0[1]
        xs = s["k0"][0] + us * a0[0] + vs * n0[0]
        out = out + sample(layer, ys, xs) / 3
    return out


def boots(layer, states):
    from rig import compose
    pieces = []
    for side, s in states.items():
        ramp = np.clip((np.arange(layer.shape[0]) - (KNEE_ROW - SHIN_OVERLAP)) / 6, 0, 1).astype(np.float32)
        mask = np.where(np.arange(layer.shape[0]) >= KNEE_ROW, 1.0, ramp * s["e"] ** 0.5 if s["e"] > 0 else 0.0).astype(np.float32)[:, None, None]
        half = (np.arange(layer.shape[1]) < 384 if side == "L" else np.arange(layer.shape[1]) >= 384).astype(np.float32)[None, :, None]
        pieces.append(shin(layer * mask * half, side, s))
    return compose(pieces)


def no_crumbs(image):
    """Takes away the few loose pixels the warp leaves around the legs."""
    from PIL import Image
    from scipy import ndimage as ndi
    rgba = np.array(image.convert("RGBA"))
    labels, count = ndi.label(rgba[..., 3] > 0)
    sizes = ndi.sum(np.ones_like(labels), labels, range(1, count + 1))
    rgba[np.isin(labels, np.nonzero(sizes < 40)[0] + 1)] = 0
    return Image.fromarray(rgba, "RGBA")


def main():
    only = [int(v) for v in sys.argv[1].split(",")] if len(sys.argv) > 1 else list(range(1, FRAMES + 1))
    kneel3.LEGS = LEGS
    kneel3.KNEES, kneel3.SIT, kneel3.SWAY, kneel3.CLOTH = KNEES, SIT, SWAY, CLOTH
    kneel3.leg_state, kneel3.rows_of, kneel3.cap, kneel3.boots = leg_state, rows_of, cap, boots
    kneel3.BLEND = (372, 394)
    scene = render.Scene()
    pained(scene)
    a = fast_anim()
    rig.M = a
    body = scene.layers["body"]
    cut = (np.arange(body.shape[0]) < KNEE_ROW).astype(np.float32)[:, None, None]
    out = os.path.join("poses", "crushed")
    if len(sys.argv) <= 1:
        for old in os.listdir(out):
            os.remove(os.path.join(out, old))
    for n in only:
        image = no_crumbs(drop_specks(to_game(np.clip(frame_at(a, n - 1, scene, body * cut, body), 0, 1))))
        image.save(os.path.join(out, f"{n:02d}.webp"), quality=88, alpha_quality=95, method=6)
    print("done", len(only), flush=True)


if __name__ == "__main__":
    main()
