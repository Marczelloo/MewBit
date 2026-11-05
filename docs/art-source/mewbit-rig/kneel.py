"""She drops to her knees: the rig's opening, then in-betweens warped between Klein's keys, always with the drawing's own head."""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.interpolate import RBFInterpolator

import render
import rig
from anims import ANIMS
from rig import FEET_Y, PAD, to_game
from kneelcore import FITS, HEAD_CENTRE, SIZE, head_params, key_canvas, over, place_head

# Corresponding points on each key at the drawing's scale. A point a key lacks (hair hidden behind the jacket) is left out of its pairs.
POINTS = {
    "rig": dict(choker=(358, 264), tri=(372, 334), belt=(368, 524), shL=(322, 300), shR=(482, 300), slvL=(208, 580), slvR=(576, 500), hemL=(228, 656), hemR=(542, 640),
                wristL=(225, 620), wristR=(505, 630), handL=(212, 650), handR=(512, 670), thighL=(312, 680), thighR=(432, 680), kneeL=(292, 880), kneeR=(462, 880),
                ankleL=(288, 980), ankleR=(512, 980), bootL=(282, 1110), bootR=(522, 1110), hairL=(182, 560)),
    "buckle-37": dict(choker=(380, 360), tri=(380, 410), belt=(374, 534), shL=(316, 380), shR=(476, 360), slvL=(176, 600), slvR=(610, 540), hemL=(250, 704), hemR=(556, 730),
                      wristL=(185, 610), wristR=(585, 620), handL=(176, 650), handR=(590, 660), thighL=(330, 680), thighR=(460, 680), kneeL=(330, 800), kneeR=(420, 800),
                      ankleL=(310, 960), ankleR=(470, 960), bootL=(300, 1120), bootR=(480, 1120), hairL=(150, 550)),
    "buckle-23": dict(choker=(380, 520), tri=(386, 570), belt=(380, 694), shL=(306, 500), shR=(482, 500), slvL=(192, 680), slvR=(592, 690), hemL=(226, 860), hemR=(512, 860),
                      wristL=(190, 780), wristR=(590, 780), handL=(176, 810), handR=(602, 810), thighL=(292, 790), thighR=(452, 790), kneeL=(328, 870), kneeR=(432, 870),
                      ankleL=(282, 980), ankleR=(472, 980), bootL=(262, 1120), bootR=(482, 1120), hairL=(142, 690)),
    "low-41": dict(choker=(400, 714), tri=(400, 766), belt=(398, 876), shL=(314, 720), shR=(484, 720), slvL=(204, 880), slvR=(594, 880), hemL=(224, 960), hemR=(544, 960),
                   wristL=(200, 950), wristR=(600, 950), handL=(184, 990), handR=(614, 980), thighL=(320, 910), thighR=(470, 910), kneeL=(314, 940), kneeR=(464, 940),
                   ankleL=(224, 1010), ankleR=(564, 1010), bootL=(144, 1080), bootR=(634, 1080), hairL=(124, 770), hairR=(674, 690)),
    "low2-23": dict(choker=(402, 672), tri=(402, 730), belt=(398, 858), shL=(312, 700), shR=(490, 700), slvL=(200, 860), slvR=(600, 880), hemL=(230, 960), hemR=(540, 960),
                    wristL=(190, 950), wristR=(606, 955), handL=(170, 976), handR=(616, 980), thighL=(300, 925), thighR=(470, 925), kneeL=(300, 940), kneeR=(470, 940),
                    ankleL=(190, 1030), ankleR=(530, 1030), bootL=(130, 1060), bootR=(640, 1050), hairL=(100, 730), hairR=(710, 590), hairL2=(140, 820), hairR2=(700, 640)),
    "land-23": dict(choker=(396, 744), tri=(396, 796), belt=(394, 900), shL=(320, 730), shR=(480, 740), slvL=(236, 940), slvR=(560, 940), hemL=(280, 1000), hemR=(500, 1000),
                    wristL=(332, 1040), wristR=(440, 1040), handL=(356, 1100), handR=(424, 1100), thighL=(270, 1020), thighR=(490, 1020), kneeL=(262, 1090), kneeR=(498, 1090),
                    ankleL=(180, 1030), ankleR=(570, 1030), bootL=(130, 1050), bootR=(620, 1050), hairL=(130, 754), hairR=(644, 754), hairL2=(130, 920), hairR2=(636, 980)),
    "bow-23": dict(choker=(404, 744), tri=(404, 796), belt=(404, 900), shL=(326, 730), shR=(486, 740), slvL=(234, 940), slvR=(564, 940), hemL=(284, 1000), hemR=(506, 1000),
                   wristL=(332, 1040), wristR=(444, 1040), handL=(354, 1096), handR=(434, 1096), thighL=(274, 1020), thighR=(494, 1020), kneeL=(266, 1090), kneeR=(502, 1090),
                   ankleL=(184, 1030), ankleR=(574, 1030), bootL=(134, 1050), bootR=(624, 1050), hairL=(226, 800), hairR=(566, 820), hairL2=(234, 930), hairR2=(584, 960)),
}
# Fixed points of the drawing's head, moved with the head of each key.
HEAD_POINTS = np.array([(304, 70), (470, 50), (396, 240), (300, 160), (490, 160)], float)

STEP = 8
FLOOR = FEET_Y + PAD[1]


def head_points(params, sy=1.0):
    a = np.deg2rad(params[2])
    c, s = np.cos(a), np.sin(a)
    d = (HEAD_POINTS - HEAD_CENTRE) * (1, sy)
    return np.stack([params[0] + c * d[:, 0] - s * d[:, 1], params[1] + s * d[:, 0] + c * d[:, 1]], 1)


def warp_to(canvas, src, dst):
    """Moves the points src of a canvas to dst by a thin-plate spline."""
    tps = RBFInterpolator(dst + PAD, src + PAD, kernel="thin_plate_spline", smoothing=2.0)
    axis = np.arange(0, SIZE + STEP, STEP, dtype=np.float32)
    gx, gy = np.meshgrid(axis, axis)
    mapped = tps(np.stack([gx.ravel(), gy.ravel()], 1)).reshape(gx.shape + (2,)).astype(np.float32)
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / STEP
    sx = ndi.map_coordinates(mapped[..., 0], [ys, xs], order=1)
    sy = ndi.map_coordinates(mapped[..., 1], [ys, xs], order=1)
    return np.dstack([ndi.map_coordinates(canvas[..., c], [sy, sx], order=3, mode="constant") for c in range(4)]).clip(0, 1)


def ease(t, kind):
    t = float(np.clip(t, 0, 1))
    if kind == "in":
        return t * t
    if kind == "out":
        return 1 - (1 - t) ** 2
    if kind == "soft":
        return t * t * (3 - 2 * t)
    return t


class Key:
    def __init__(self, name, canvas, head):
        self.name, self.canvas, self.head = name, canvas, head
        self.points = {k: np.array(v, float) for k, v in POINTS.get(name, {}).items()}


# From frame, to frame, keys, easing of the motion, frames of crossing between the two drawings (0 is a clean cut at the middle).
SEGMENTS = [
    (6, 11, "rig", "buckle-37", "in", 0),
    # The fall itself is all drawings: nothing stretched while she is in the air.
    (13, 14, "lift-half", "lift-half", "lin", 0),
    (11, 14, "buckle-37", "buckle-23", "lin", 0),
    (14, 15, "lift-23", "lift-23", "lin", 0),
    (15, 16, "mid-11", "mid-11", "lin", 0),
    (16, 17, "mid-23", "mid-23", "lin", 0),
    (17, 18, "mid-53", "mid-53", "lin", 0),
    (18, 19, "low2-23", "low2-23", "lin", 0),
    (19, 20, "land-23", "land-23", "lin", 0),
    (20, 26, "land-23", "bow-23", "soft", 0),
    (26, 27, "bow-23", "bow-23", "lin", 0),
]
FRAMES = 28
EYES = ["open", "lid1", "lid2"] + ["wince"] * 21 + ["sad"] * 4
# Compression of everything above the floor when the knees hit.
SQUASH = {20: 0.075, 21: 0.05, 22: 0.018, 23: -0.012, 24: -0.006}
# The head keeps sinking after the knees stopped: y px, turn degrees, height factor.
SINK = {f: v for f, v in zip(range(23, 28), [(2, .2, .998), (6, .7, .992), (9, 1.1, .988), (12, 1.3, .985), (13, 1.4, .984)])}


# Keeps the head falling through the drawings: upper body down by y px, the legs below the belt line take it up. Frame: (y, belt).
SETTLE = {15: (36, 730), 16: (58, 740), 17: (26, 760), 19: (32, 858)}


def settle(canvas, dy, belt):
    belt += PAD[1]
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    sy = np.where(ys < belt + dy, ys - dy, FLOOR - (FLOOR - ys) * (FLOOR - belt) / (FLOOR - belt - dy))
    return np.dstack([ndi.map_coordinates(canvas[..., c], [sy, xs], order=3, mode="constant") for c in range(4)]).clip(0, 1)


def squash(canvas, a):
    if not a:
        return canvas
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    sy = FLOOR - (FLOOR - ys) / (1 - a)
    mid = PAD[0] + 390
    wide = 1 + 0.45 * a * np.clip((FLOOR - ys) / 400, 0, 1)
    sx = mid + (xs - mid) / wide
    return np.dstack([ndi.map_coordinates(canvas[..., c], [sy, sx], order=1, mode="constant") for c in range(4)])


def pained(scene):
    """Shut eyes with the unhappy mouth: the wince's own little smile reads wrong when she falls."""
    ys, xs = np.mgrid[0:1152, 0:768].astype(np.float32)
    mask = ndi.gaussian_filter(((xs - 403) / 34) ** 2 + ((ys - 212) / 21) ** 2 < 1, 3.0, output=np.float32)[..., None]
    scene.heads["wince"] = scene.heads["wince"] * (1 - mask) + scene.heads["sad"] * mask


# The first flick of the hair, on the lift drawing: the body stays, the locks are only halfway up.
BODY = [(383, 506), (383, 730), (291, 536), (480, 536), (190, 720), (583, 740), (208, 830), (583, 830), (306, 900), (475, 900), (245, 1100), (490, 1100)]
HAIR_UP = [(680, 414), (583, 506), (690, 430), (86, 552), (153, 613), (123, 736)]
HAIR_HALF = [(635, 525), (565, 555), (640, 535), (130, 625), (172, 650), (150, 745)]


def lift_half(key):
    src = np.vstack([head_points(key.head), BODY, HAIR_UP])
    dst = np.vstack([head_points(key.head), BODY, HAIR_HALF])
    half = Key("lift-half", warp_to(key.canvas, src, dst), key.head)
    return half


def rig_opening(scene):
    render.to_game = lambda c: c
    render.drop_specks = lambda c: c
    anim = ANIMS["crushed"]()
    rig.M = anim
    frames = [np.asarray(render.render_frame(anim, f, scene)).astype(np.float32) for f in range(7)]
    t = np.float64(6 / anim.frames)
    q = rig.head(np.array([HEAD_CENTRE, (HEAD_CENTRE[0] + 100, HEAD_CENTRE[1])]), t)
    turn = np.rad2deg(np.arctan2(q[1, 1] - q[0, 1], q[1, 0] - q[0, 0]))
    return frames, np.array([q[0, 0], q[0, 1], turn, 1.0])


def frame_at(f, keys, scene, opening):
    if f <= 6:
        return opening[f]
    for f0, f1, a, b, kind, cross in SEGMENTS:
        if f0 < f <= f1:
            break
    t = ease((f - f0) / (f1 - f0), kind)
    A, B = keys[a], keys[b]
    head = (1 - t) * A.head + t * B.head
    if a == b and f not in SINK:
        body, moved = A.canvas, head
        if f in SETTLE:
            body = settle(body, *SETTLE[f])
            moved = head + np.array([0, SETTLE[f][0], 0, 0])
        return squash(over(body, place_head(scene.heads[EYES[f]], moved)), SQUASH.get(f, 0))
    names = [n for n in A.points if n in B.points]
    pa = np.vstack([head_points(A.head), [A.points[n] for n in names]])
    pb = np.vstack([head_points(B.head), [B.points[n] for n in names]])
    at = (1 - t) * pa + t * pb
    dy, dturn, sy = SINK.get(f, (0, 0, 1))
    params = head + np.array([0, dy, dturn, 0])
    at[: len(HEAD_POINTS)] = head_points(params, sy)
    if cross:
        mid = (f0 + f1) / 2
        w = float(np.clip((f - mid) / cross + 0.5, 0, 1))
    else:
        w = 0.0 if t < 0.5 else 1.0
    if w <= 0:
        body = warp_to(A.canvas, pa, at)
    elif w >= 1:
        body = warp_to(B.canvas, pb, at)
    else:
        body = (1 - w) * warp_to(A.canvas, pa, at) + w * warp_to(B.canvas, pb, at)
    full = over(body, place_head(scene.heads[EYES[f]], params, sy))
    return squash(full, SQUASH.get(f, 0))


def main():
    only = [int(v) for v in sys.argv[1].split(",")] if len(sys.argv) > 1 else range(1, FRAMES + 1)
    scene = render.Scene()
    clean = render.drop_specks
    pained(scene)
    opening, head = rig_opening(scene)
    print("rig head", np.round(head, 1), flush=True)
    keys = {"rig": Key("rig", opening[6], head)}
    for name in ("buckle-37", "buckle-23", "lift-23", "mid-11", "mid-23", "mid-53", "low2-23", "land-23", "bow-23"):
        keys[name] = Key(name, key_canvas(name), head_params(name))
    keys["lift-half"] = lift_half(keys["lift-23"])
    out = os.path.join("poses", "crushed")
    os.makedirs(out, exist_ok=True)
    if len(sys.argv) <= 1:
        for old in os.listdir(out):
            os.remove(os.path.join(out, old))
    for n in only:
        image = clean(to_game(np.clip(frame_at(n - 1, keys, scene, opening), 0, 1)))
        image.save(os.path.join(out, f"{n:02d}.webp"), quality=88, alpha_quality=95, method=6)
    print("done", len(list(only)), flush=True)


if __name__ == "__main__":
    main()
