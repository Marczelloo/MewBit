"""She drops to her knees: boots planted, knees buckle in and come down, they hit the floor with the hips still up, hands to her thighs, then she sinks onto her heels."""
import os
import sys

import numpy as np
from scipy import ndimage as ndi

import render
from kneel import HEAD_POINTS, POINTS as OLD, SINK, ease, head_points, pained, rig_opening, squash, warp_to
from kneelcore import SIZE, head_map, head_params, key_canvas, over, place_head
from legfix import fix_stockings
from rig import to_game

# Soles measured with kneelsoles.py: a boot's point is 10 above its sole at the sole's centre, and the feet are put back where they stood.
STOOD = dict(bootL=(275.5, 1106), bootR=(517.5, 1115))
POINTS = {
    "rig": {**OLD["rig"], **STOOD},
    "buckle-37": {**OLD["buckle-37"], "bootL": (302, 1111), "bootR": (481.5, 1116)},
    "col-a-41": dict(choker=(396, 506), tri=(396, 562), belt=(397, 685), shL=(312, 494), shR=(481, 494), slvL=(181, 712), slvR=(609, 712), hemL=(256, 856), hemR=(537, 860),
                     wristL=(187, 794), wristR=(612, 787), handL=(194, 819), handR=(612, 812), thighL=(337, 775), thighR=(456, 775), kneeL=(369, 862), kneeR=(419, 862),
                     ankleL=(306, 956), ankleR=(481, 956), bootL=(269.5, 1111), bootR=(504, 1116), hairL=(62, 612), hairR=(681, 531), hairL2=(125, 750), hairR2=(650, 756)),
    "col-d-41": dict(choker=(392, 612), tri=(395, 669), belt=(395, 794), shL=(307, 625), shR=(482, 625), slvL=(195, 800), slvR=(601, 812), hemL=(270, 962), hemR=(532, 962),
                     wristL=(189, 887), wristR=(601, 887), handL=(195, 925), handR=(614, 925), thighL=(339, 962), thighR=(451, 962), kneeL=(339, 1112), kneeR=(451, 1112),
                     ankleL=(270, 1050), ankleR=(520, 1050), bootL=(182, 1056), bootR=(607, 1056), hairL=(95, 644), hairR=(657, 631), hairL2=(107, 850), hairR2=(695, 787)),
    "col-f-23": dict(choker=(381, 687), tri=(381, 744), belt=(375, 860), shL=(300, 681), shR=(462, 681), slvL=(219, 950), slvR=(550, 900), hemL=(256, 987), hemR=(531, 987),
                     wristL=(306, 931), wristR=(456, 937), handL=(337, 981), handR=(412, 981), thighL=(331, 1025), thighR=(431, 1025), kneeL=(337, 1119), kneeR=(431, 1119),
                     ankleL=(269, 1062), ankleR=(506, 1062), bootL=(169, 1062), bootR=(600, 1050), hairL=(94, 719), hairR=(625, 700), hairL2=(131, 956), hairR2=(606, 944)),
    "land-23": OLD["land-23"],
    "bow-23": OLD["bow-23"],
}
POSE = {
    "buckle-37": dict(STOOD, ankleL=(286, 960), ankleR=(504, 960)),
    "col-a-41": dict(STOOD, ankleL=(311, 955), ankleR=(492, 955)),
}
# Stockings of each key, in the drawing's coordinates on the key's floor.
STOCKINGS = {
    "buckle-37": [[(290, 650), (490, 650), (490, 720), (445, 800), (495, 950), (455, 965), (400, 850), (375, 850), (340, 965), (285, 950), (325, 800), (290, 720)]],
    "col-a-41": [[(292, 745), (485, 745), (500, 860), (490, 965), (290, 965), (280, 950), (290, 860)]],
    "col-d-41": [[(303, 955), (507, 955), (507, 1030), (540, 1040), (540, 1090), (507, 1125), (303, 1125), (265, 1090), (265, 1040), (303, 1030)]],
    "col-f-23": [[(285, 975), (475, 975), (481, 1040), (510, 1045), (510, 1095), (470, 1125), (300, 1125), (260, 1095), (260, 1045), (290, 1040)]],
    "land-23": [[(215, 1000), (300, 990), (330, 1060), (340, 1125), (230, 1125), (215, 1070)], [(470, 1005), (575, 1000), (580, 1075), (565, 1125), (455, 1125), (450, 1060)]],
    "bow-23": [[(221, 1000), (306, 990), (336, 1060), (346, 1125), (236, 1125), (221, 1070)], [(476, 1005), (581, 1000), (586, 1075), (571, 1125), (461, 1125), (456, 1060)]],
}
PATH = ["rig", "buckle-37", "col-a-41", "col-d-41", "col-f-23", "land-23"]
# Head height in the drawing's pixels: it speeds up until the knees hit (19), then the hips carry on down to the heels (23).
FALL = {7: 177, 8: 184, 9: 195, 10: 210, 11: 230, 12: 255, 13: 288, 14: 325, 15: 368, 16: 414, 17: 452, 18: 498, 19: 514, 20: 545, 21: 577, 22: 592, 23: 617, 24: 648}
LAST_FALL = 24
# Parts that stay with their own key: they barely move while that key is warped and snap to the other key's place at the cut.
ARRIVE = {
    ("col-a-41", "col-d-41"): dict(bootL=3, bootR=3, ankleL=2, ankleR=2),
    ("col-d-41", "col-f-23"): dict(handL=2, handR=2, wristL=2, wristR=2, slvL=2, slvR=2),
}
FRAMES = 28
EYES = ["open", "lid1", "lid2"] + ["wince"] * 21 + ["sad"] * 4
# Rows of the drawing's head layer: above the first the key's own head is gone, by the second it is all there.
HEAD_CLEAR, HEAD_RAMP = 185, 15
SQUASH = {19: 0.015, 24: 0.03, 25: 0.018, 26: 0.006}


def attach_lock(canvas, dx=-50, dy=-6):
    """The right lock of this key floats free of her: slide it in behind the jacket."""
    labels, count = ndi.label(canvas[..., 3] > 0.3)
    areas = ndi.sum(np.ones_like(labels), labels, range(1, count + 1))
    body = int(np.argmax(areas)) + 1
    result = canvas
    for i in range(1, count + 1):
        if i == body or areas[i - 1] < 300 or ndi.center_of_mass(labels == i)[1] < canvas.shape[1] / 2:
            continue
        mask = ndi.binary_dilation(labels == i, iterations=3)[..., None]
        lock = np.roll(canvas * mask, (dy, dx), axis=(0, 1))
        result = over(lock, result * (1 - mask))
        print("moved a lock of", int(areas[i - 1]), flush=True)
    return result


PREPARE = {"col-f-23": attach_lock}


class Key:
    def __init__(self, name, canvas, head):
        self.name, self.head = name, head
        canvas = PREPARE[name](canvas) if name in PREPARE else canvas
        self.canvas = fix_stockings(canvas, STOCKINGS[name]) if name in STOCKINGS else canvas
        self.points = {k: np.array(v, float) for k, v in POINTS[name].items()}
        self.pose = {**self.points, **{k: np.array(v, float) for k, v in POSE.get(name, {}).items()}}


def clear_head(body, params, sy):
    """Take away the key's own head, which sticks out around the drawing's head that goes on top of it."""
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    row = head_map(params, sy)(xs, ys)[1]
    return body * np.clip((row - HEAD_CLEAR) / HEAD_RAMP, 0, 1)[..., None]


def between(f, keys):
    """The two keys around this frame and how far along."""
    if f > LAST_FALL:
        return keys["land-23"], keys["bow-23"], ease((f - LAST_FALL) / (FRAMES - 1 - LAST_FALL), "soft")
    y = max(FALL[f], keys["rig"].head[1])
    for a, b in zip(PATH, PATH[1:]):
        if y <= keys[b].head[1]:
            return keys[a], keys[b], (y - keys[a].head[1]) / (keys[b].head[1] - keys[a].head[1])
    return keys[PATH[-2]], keys[PATH[-1]], 1.0


def frame_at(f, keys, scene, opening):
    if f <= 6:
        return opening[f]
    A, B, t = between(f, keys)
    head = (1 - t) * A.head + t * B.head
    names = [n for n in A.points if n in B.points]
    pa = np.vstack([head_points(A.head), [A.points[n] for n in names]])
    pb = np.vstack([head_points(B.head), [B.points[n] for n in names]])
    own = ARRIVE.get((A.name, B.name), {})
    at = np.vstack([head_points(A.head), [A.pose[n] + t ** (own.get(n, 1) if t < 0.5 else 1 / own.get(n, 1)) * (B.pose[n] - A.pose[n]) for n in names]])
    dy, dturn, sy = SINK.get(f, (0, 0, 1))
    params = head + np.array([0, dy, dturn, 0])
    at[: len(HEAD_POINTS)] = head_points(params, sy)
    shown = A if t < 0.5 else B
    body = warp_to(shown.canvas, pa if t < 0.5 else pb, at)
    if shown.name != "rig":
        body = clear_head(body, params, sy)
    return squash(over(body, place_head(scene.heads[EYES[f]], params, sy)), SQUASH.get(f, 0))


def main():
    only = [int(v) for v in sys.argv[1].split(",")] if len(sys.argv) > 1 else range(1, FRAMES + 1)
    scene = render.Scene()
    clean = render.drop_specks
    pained(scene)
    opening, head = rig_opening(scene)
    keys = {"rig": Key("rig", opening[6], head)}
    for name in PATH[1:] + ["bow-23"]:
        keys[name] = Key(name, key_canvas(name), head_params(name))
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
