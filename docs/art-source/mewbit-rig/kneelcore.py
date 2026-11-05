"""Keys of the fall on the rig's canvas, and the drawing's head placed by each key's fit."""
import json

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

from rig import PAD
from segment import cut_alpha, load

SIZE = 1336
HEAD_CENTRE = (396.0, 152.0)
FITS = json.load(open("kneel/fits.json"))


def key_canvas(name):
    """The key at the drawing's scale on the rig's canvas, premultiplied."""
    fit = FITS[name]
    color, alpha = cut_alpha(load(fit["path"]))
    pm = np.dstack([color * alpha[..., None], alpha]).astype(np.float32)
    h, w = alpha.shape
    s = fit["scale"]
    # Output pixel -> key pixel: undo PAD and shift, then scale up.
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    sx = (xs - PAD[0] - fit["shift"][0]) * s
    sy = (ys - PAD[1] - fit["shift"][1]) * s
    # Shrinking by s: soften a little first so lines don't alias.
    soft = np.dstack([ndi.gaussian_filter(pm[..., c], 0.35 * max(s - 1, 0) + 1e-3) for c in range(4)])
    out = np.dstack([ndi.map_coordinates(soft[..., c], [sy, sx], order=3, mode="constant") for c in range(4)])
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    out[..., :3] = np.clip(out[..., :3], 0, out[..., 3:])
    return out


def head_params(name, sign=1):
    fit = FITS[name]
    return np.array([fit["head"][0], fit["head"][1], sign * fit["turn"], 1.0])


def head_map(params, sy=1.0):
    """Canvas position (x, y arrays) -> position in the drawing's head layer, for head params x, y, turn, unused."""
    x, y, turn = params[:3]
    a = np.deg2rad(turn)
    c, s = np.cos(a), np.sin(a)

    def back(xs, ys):
        dx, dy = xs - PAD[0] - x, ys - PAD[1] - y
        return HEAD_CENTRE[0] + c * dx + s * dy, HEAD_CENTRE[1] + (-s * dx + c * dy) / sy

    return back


def place_head(layer, params, sy=1.0):
    """The drawing's head layer (768x1152) moved onto the canvas."""
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    sx, syy = head_map(params, sy)(xs, ys)
    return np.dstack([ndi.map_coordinates(layer[..., c], [syy, sx], order=3, mode="constant") for c in range(4)]).clip(0, 1)


def over(under, top):
    return top + under * (1 - top[..., 3:])
