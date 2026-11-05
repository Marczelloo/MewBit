"""Every animation as data for the rig: curves of time (0 to 1 over the clip), eyes per frame, key drawings per frame.

Elevation is the arm's angle from hanging straight down, 180 is straight up. The renderer picks the key drawing closest to
the current elevation and turns it the rest of the way, so a raise is drawn keys tweened by a smooth arc.
"""
import numpy as np
from scipy.interpolate import PchipInterpolator


def zero(t):
    return 0 * np.asarray(t, dtype=np.float64)


class Anim:
    lag = 1.0
    loop = True
    hip_x = hip_drop = hip_tilt = chest_tilt = slump = staticmethod(zero)
    head_tilt = head_bob = head_x = nod = head_squash = staticmethod(zero)
    knee = arm_swing = sleeve = hand = hair_x = hair_y = staticmethod(zero)
    lean = root_x = lift = staticmethod(zero)
    wob_l = wob_r = staticmethod(zero)
    elev = None
    series = ()
    limbs = ()

    def __init__(self, frames, fps, **fields):
        self.frames, self.fps = frames, fps
        self.key_at = {}
        self.eyes = ["open"] * frames
        # Lags are written for the 2.67 s of vibe1, as fractions of the clip.
        self.lag = self.full_lag = (64 / 24) / (frames / fps)
        for name, value in fields.items():
            setattr(self, name, value)

    def at_frame(self, frame):
        # A clip that stops has to catch up with itself by its last frame, or the hair freezes mid swing.
        if not self.loop:
            self.lag = self.full_lag * (1 - smooth((frame / (self.frames - 1) - 0.5) / 0.5))


def wave(cycles, amp=1.0, phase=0.0):
    return lambda t: amp * np.sin(2 * np.pi * (cycles * t + phase))


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def beat(count, amp=1.0, phase=0.0, attack=0.36):
    """Quick drop on the beat, slower recovery."""

    def curve(t):
        x = np.mod(count * t + phase, 1.0)
        return amp * np.where(x < attack, smooth(x / attack), 1 - smooth((x - attack) / (1 - attack)))

    return curve


def plus(*curves):
    return lambda t: sum(curve(t) for curve in curves)


def const(value):
    return lambda t: value + zero(t)


def track(frames, *points):
    """Monotone spline through (frame, value); holds its ends, so the follow-through lag can read before the first frame.

    A flat point past each end gives the spline zero slope there: a clip that stops eases to rest instead of freezing mid move.
    """
    xs, ys = zip(*points)
    spline = PchipInterpolator([xs[0] - 1, *xs, xs[-1] + 1], [ys[0], *ys, ys[-1]])
    return lambda t: spline(np.clip(np.asarray(t) * frames, xs[0], xs[-1]))


def eyes_blink(a, frame, shut="closed", half=True):
    """A six-frame blink at 24 fps, three at 12."""
    steps = ["lid1", "lid2", shut, shut, "lid2", "lid1"] if half else ["lid2", shut, "lid2"]
    for i, state in enumerate(steps):
        a.eyes[frame + i] = state


def eyes_shut(a, start, end, state="closed", lids=("lid1", "lid2")):
    """Lids down into `state` by `start` and up again after `end`; end=None keeps them shut."""
    for f, lid in zip(range(start - len(lids), start), lids):
        a.eyes[f] = lid
    last = a.frames if end is None else end
    for f in range(start, last):
        a.eyes[f] = state
    if end is not None:
        for f, lid in zip(range(end, end + len(lids)), reversed(lids)):
            if f < a.frames:
                a.eyes[f] = lid


def vibe1():
    # Approved as rendered: only kept to prove the bones still match it.
    a = Anim(
        64, 24,
        hip_x=wave(2, 10), hip_drop=beat(4, 15), hip_tilt=wave(2, 0.9), chest_tilt=wave(2, -1.5),
        head_tilt=wave(2, 3), head_bob=beat(4, 0.8), nod=beat(4, 6), knee=beat(4, 3.7), arm_swing=wave(2, 1.3),
        sleeve=plus(const(1.0), wave(2, 1.6)), hand=plus(const(3.0), wave(2, 5)),
        hair_x=wave(2, 16), hair_y=beat(4, 4.8),
    )
    eyes_blink(a, 9)
    eyes_shut(a, 33, 60)
    return a


def neutral():
    # Standing and breathing: nothing but the chest, the weight and a slow drift of hair.
    a = Anim(
        64, 16,
        hip_x=wave(1, 3), hip_tilt=wave(1, 0.3), chest_tilt=wave(1, -0.4), slump=wave(2, 2.2),
        head_tilt=wave(1, 1.2, 0.05), nod=wave(2, 1.6, 0.02), arm_swing=wave(1, 0.4),
        sleeve=wave(1, 0.8, 0.04), hand=wave(1, 1.6, 0.08), hair_x=wave(1, 5, 0.03), hair_y=wave(2, 1.5, 0.03),
    )
    eyes_blink(a, 20)
    eyes_blink(a, 50)
    return a


def vibe2():
    # A bigger groove with the free arm out, keeping time. The bend stays in the legs and the weight, not the spine.
    a = Anim(
        64, 24,
        series=(("arm_low", None),), elev=const(30), wob_l=plus(wave(2, 6, 0.02), beat(4, 3)),
        hip_x=wave(2, 15), hip_drop=beat(4, 18), hip_tilt=wave(2, 1.2), chest_tilt=wave(2, -1.8),
        head_tilt=wave(2, -3.5, 0.03), head_bob=beat(4, 1.2), nod=beat(4, 8), knee=beat(4, 4.5), arm_swing=wave(2, 1.2),
        hair_x=wave(2, 22), hair_y=beat(4, 6),
    )
    eyes_blink(a, 5)
    eyes_shut(a, 34, 60, "happy")
    return a


def vibe3():
    # Fist up, pumping on every beat.
    a = Anim(
        48, 24,
        series=(("arm_up", None),), elev=const(172), wob_l=beat(4, 13, 0.92),
        hip_x=wave(2, 11), hip_drop=beat(4, 20), hip_tilt=wave(2, 1.0), chest_tilt=wave(2, -1.4),
        head_tilt=wave(2, 3.5, 0.03), head_bob=beat(4, 1.2), nod=beat(4, 10), knee=beat(4, 5), arm_swing=wave(2, 1.2),
        hair_x=wave(2, 20), hair_y=beat(4, 8), lift=beat(4, 5, 0.5),
    )
    eyes_shut(a, 3, 24, "happy")
    eyes_blink(a, 34)
    return a


def fever():
    # Jumping with both arms up, hair flying.
    a = Anim(
        48, 24,
        series=(("both_up", None),), elev=const(172), wob_l=plus(wave(2, 9), beat(4, 6, 0.9)), wob_r=plus(wave(2, -9), beat(4, 6, 0.9)),
        hip_x=wave(2, 12), hip_drop=beat(4, 12), hip_tilt=wave(2, 1.4), chest_tilt=wave(2, -2),
        head_tilt=wave(2, 6, 0.03), head_bob=beat(4, 1.5), nod=beat(4, 12), knee=beat(4, 4.5), arm_swing=wave(2, 2),
        hair_x=wave(2, 36), hair_y=beat(4, 22, 0.1), lift=beat(4, 20, 0.45, attack=0.5),
    )
    a.eyes = ["happy"] * 48
    return a


def miss():
    n = 14
    a = Anim(
        n, 24, loop=False,
        lean=track(n, (0, 0), (2, -2.0), (5, -1.2), (13, -0.9)), hip_x=track(n, (0, 0), (2, -8), (13, -4)),
        hip_drop=track(n, (0, 0), (2, 10), (6, 5), (13, 6)), knee=track(n, (0, 0), (2, 3), (13, 1.5)),
        head_tilt=track(n, (0, 0), (2, 4), (6, 2), (13, 2.5)), nod=track(n, (0, 0), (2, -5), (5, 4), (13, 3)),
        sleeve=track(n, (0, 0), (2, 7), (6, -2), (13, 1)), hand=track(n, (0, 0), (2, 10), (7, -3), (13, 2)),
        hair_x=track(n, (0, 0), (2, 16), (6, -9), (10, 3), (13, 0)), hair_y=track(n, (0, 0), (3, -8), (7, 4), (13, 0)),
    )
    a.eyes = ["open", "lid2"] + ["wince"] * (n - 2)
    return a


def crushed():
    n = 28
    a = Anim(
        n, 24, loop=False,
        lean=track(n, (0, 0), (3, -1.2), (14, 0.8), (27, 0.6)), hip_drop=track(n, (0, 0), (2, 6), (14, 26), (18, 21), (27, 24)),
        knee=track(n, (0, 0), (14, 7), (27, 6)), slump=track(n, (0, 0), (3, 3), (14, 15), (18, 12), (27, 14)),
        nod=track(n, (0, 0), (2, -4), (14, 22), (18, 18), (27, 20)), head_squash=track(n, (0, 0), (2, 0), (14, 0.075), (27, 0.065)),
        head_tilt=track(n, (0, 0), (3, 2), (14, -3), (27, -2.5)),
        hair_x=track(n, (0, 0), (3, 10), (10, -8), (18, 4), (27, 0)), hair_y=track(n, (0, 0), (5, -8), (14, 14), (20, 6), (27, 9)),
        # The hand slides off the hip and both arms fall: elevation here only runs from the drawing to the key.
        series=((None, 0), ("both_down", 1)), elev=track(n, (0, 0), (2, 0.05), (7, 1), (27, 1)),
        wob_l=track(n, (0, 0), (7, -4), (14, 3), (27, 0)), wob_r=track(n, (0, 0), (7, -6), (14, 3), (27, 0)),
    )
    a.eyes = ["open", "lid1", "lid2"] + ["wince"] * 8 + ["sad"] * (n - 11)
    return a


def milestone():
    n = 21
    a = Anim(
        n, 24, loop=False,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_high", None), ("arm_up", None)),
        elev=track(n, (0, 16), (3, 10), (5, 30), (8, 150), (10, 182), (13, 168), (20, 172)),
        hip_drop=track(n, (0, 0), (3, 24), (6, 4), (9, -2), (12, 0), (14, 18), (17, 4), (20, 6)),
        knee=track(n, (0, 0), (3, 7), (6, 0), (12, 0), (14, 5), (17, 1), (20, 1)),
        lift=track(n, (0, 0), (4, 0), (8, 34), (10, 40), (12, 18), (13, 0), (20, 0)),
        lean=track(n, (0, 0), (3, -0.6), (9, 1.4), (20, 0.9)),
        hip_x=track(n, (0, 0), (3, -4), (9, 8), (20, 5)), chest_tilt=track(n, (0, 0), (9, -1.5), (20, -1.0)),
        head_tilt=track(n, (0, 0), (3, 1.5), (9, -3.5), (14, -1), (20, -2.5)), nod=track(n, (0, 0), (3, 7), (8, -3), (14, 7), (17, 0), (20, 1)),
        hair_x=track(n, (0, 0), (4, -8), (10, 12), (15, -6), (20, 0)), hair_y=track(n, (0, 0), (3, 6), (8, 18), (13, -12), (17, 5), (20, 0)),
    )
    eyes_shut(a, 8, None, "happy")
    return a


def charting():
    # A finger on the chin, working the chart out.
    a = Anim(
        48, 12,
        series=(("arm_chin", None),), elev=const(0), rests={"arm_chin": 0}, wob_l=wave(2, 1.0),
        hip_x=wave(1, 2.5), slump=wave(2, 1.6), head_tilt=plus(const(1), wave(1, 2.2)), nod=wave(2, 2),
        hair_x=wave(1, 5, 0.04), hair_y=wave(2, 1.5, 0.04),
    )
    eyes_blink(a, 14, half=False)
    eyes_blink(a, 37, half=False)
    return a


def emerge():
    # Reaches out of the rift, then pulls the rest of herself through. The last frame is exactly the drawing, as reveal's first is.
    n = 38
    a = Anim(
        n, 24, loop=False,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_high", None)),
        elev=track(n, (0, 135), (10, 120), (18, 80), (26, 34), (31, 16), (37, 16)),
        root_x=track(n, (0, -230), (10, -170), (20, -60), (28, 8), (33, -2), (37, 0)),
        lift=track(n, (0, 0), (12, 0), (24, 8), (30, -2), (37, 0)),
        lean=track(n, (0, -10), (14, -6), (26, 1.2), (32, -0.3), (37, 0)),
        hip_drop=track(n, (0, 12), (20, 8), (30, 12), (37, 0)), knee=track(n, (0, 3), (30, 4), (37, 0)),
        head_tilt=track(n, (0, 4), (20, 2), (30, -1), (37, 0)), nod=track(n, (0, 0), (30, 3), (37, 0)),
        hair_x=track(n, (0, -26), (14, -22), (26, 14), (32, -5), (37, 0)), hair_y=track(n, (0, 0), (20, -6), (30, 6), (37, 0)),
    )
    eyes_blink(a, 24)
    return a


def reveal():
    # You found me: a peace sign and a wink, held.
    n = 30
    a = Anim(
        n, 24, loop=False,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_peace", None)),
        rests={"arm_peace": 128},
        elev=track(n, (0, 16), (3, 12), (6, 30), (11, 120), (13, 134), (16, 126), (29, 128)),
        hip_drop=track(n, (0, 0), (3, 12), (7, 0), (13, 8), (17, 2), (29, 3)), knee=track(n, (0, 0), (3, 3), (7, 0), (29, 0)),
        hip_x=track(n, (0, 0), (10, -6), (29, -4)), lean=track(n, (0, 0), (10, -0.9), (29, -0.7)),
        head_tilt=track(n, (0, 0), (3, 1), (11, -4.5), (16, -3), (29, -3.5)), nod=track(n, (0, 0), (3, 4), (8, -2), (13, 3), (29, 0)),
        hair_x=track(n, (0, 0), (6, 8), (14, -9), (22, 3), (29, 0)), hair_y=track(n, (0, 0), (3, 4), (8, -5), (14, 5), (29, 0)),
    )
    for f, state in {12: "wink1", 13: "wink2"}.items():
        a.eyes[f] = state
    for f in range(14, n):
        a.eyes[f] = "wink"
    return a


def stretch():
    # Slowly up, a long breath at the top, slowly down. Starts and ends on the drawing.
    n = 64
    a = Anim(
        n, 16,
        # A pseudo elevation past the top: clasping the hands takes its own stretch of time, on the way up and down.
        series=((None, 16), ("both_low", None), ("both_up", 160), ("stretch", 205)),
        elev=track(n, (0, 16), (5, 16), (20, 160), (30, 205), (42, 205), (48, 160), (60, 16), (64, 16)),
        hip_drop=track(n, (0, 0), (6, 6), (24, -6), (42, -6), (58, 4), (64, 0)),
        slump=track(n, (0, 0), (24, -7), (42, -8), (58, 0), (64, 0)),
        nod=track(n, (0, 0), (24, -4), (42, -5), (58, 2), (64, 0)), head_tilt=track(n, (0, 0), (24, 2), (42, -1), (58, 0), (64, 0)),
        hair_x=track(n, (0, 0), (20, 7), (34, -5), (50, 5), (64, 0)), hair_y=track(n, (0, 0), (24, -6), (42, -6), (58, 2), (64, 0)),
    )
    # The straight arm of the upper key still fits far below its own pose, the lower key tears much sooner.
    a.takes_over = {"both_up": 65}
    eyes_shut(a, 16, 46)
    return a


def adjust():
    n = 48
    a = Anim(
        n, 16,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_phones", None)),
        rests={"arm_phones": 125},
        elev=track(n, (0, 16), (4, 16), (14, 125), (34, 125), (44, 16), (48, 16)), wob_l=track(n, (0, 0), (18, 0), (21, 3), (24, -2), (27, 2), (30, 0), (48, 0)),
        head_tilt=track(n, (0, 0), (5, 0), (14, -4), (34, -4), (44, 0), (48, 0)), nod=track(n, (0, 0), (14, 2), (34, 2), (44, 0), (48, 0)),
        hip_x=track(n, (0, 0), (14, -5), (34, -5), (44, 0), (48, 0)), slump=wave(2, 1.2),
        hair_x=track(n, (0, 0), (10, -5), (20, 4), (34, 0), (42, 5), (48, 0)),
    )
    eyes_shut(a, 17, 30, "happy")
    return a


def peek():
    # Hand over the brow, leaning out to look one way and then the other.
    n = 48
    a = Anim(
        n, 16,
        series=(("arm_brow", None),), elev=const(0), rests={"arm_brow": 0},
        hip_x=wave(1, 22), hip_tilt=wave(1, 1.0), chest_tilt=wave(1, 2.4), head_tilt=wave(1, 4.5, 0.03), head_x=wave(1, 5, 0.03),
        hip_drop=beat(2, 5, 0, 0.5), knee=wave(2, 1.5), slump=wave(2, 1.2), hair_x=wave(1, 16, 0.05), hair_y=wave(2, 2, 0.05),
    )
    eyes_blink(a, 11)
    eyes_blink(a, 35)
    return a


def hype():
    # Fists up, bouncing on the spot.
    a = Anim(
        32, 24,
        series=(("both_fists", None),), elev=const(0), rests={"both_fists": 0},
        wob_l=beat(2, 8, 0.9), wob_r=beat(2, 8, 0.9),
        hip_x=wave(1, 7), hip_drop=beat(2, 16), knee=beat(2, 5), chest_tilt=wave(1, -1.2), head_tilt=wave(1, 3, 0.03),
        head_bob=beat(2, 1), nod=beat(2, 8), lift=beat(2, 14, 0.5), hair_x=wave(1, 13), hair_y=beat(2, 10, 0.08),
    )
    eyes_blink(a, 22, "happy")
    return a


def go():
    n = 22
    a = Anim(
        n, 24, loop=False,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_paw", None)),
        rests={"arm_paw": 128},
        elev=track(n, (0, 16), (3, 12), (6, 34), (10, 122), (12, 134), (15, 126), (21, 128)),
        hip_drop=track(n, (0, 0), (3, 12), (7, 0), (11, 8), (15, 2), (21, 3)), knee=track(n, (0, 0), (3, 3), (7, 0), (21, 0)),
        head_tilt=track(n, (0, 0), (3, 1), (10, -4), (15, -2.5), (21, -3)), nod=track(n, (0, 0), (3, 4), (8, -2), (12, 3), (21, 0)),
        hip_x=track(n, (0, 0), (10, -5), (21, -3)), hair_x=track(n, (0, 0), (6, 8), (13, -7), (21, 0)), hair_y=track(n, (0, 0), (3, 4), (8, -5), (13, 5), (21, 0)),
    )
    eyes_shut(a, 11, None, "wink", ("wink1", "wink2"))
    return a


def cheer():
    a = Anim(
        32, 24,
        series=(("both_up", None),), elev=const(170), wob_l=wave(1, 10), wob_r=wave(1, -10),
        hip_x=wave(1, 8), hip_drop=beat(2, 14), knee=beat(2, 4), chest_tilt=wave(1, -1.5), head_tilt=wave(1, 4, 0.03),
        nod=beat(2, 7), lift=beat(2, 22, 0.45, 0.5), hair_x=wave(1, 16), hair_y=beat(2, 14, 0.08), arm_swing=wave(1, 1.2),
    )
    a.eyes = ["happy"] * 32
    return a


def okay():
    # Fine, a small content nod.
    a = Anim(
        48, 12,
        hip_x=wave(1, 3), slump=wave(1, 1.6), head_tilt=plus(const(0), wave(1, 2)), nod=beat(2, 5, 0, 0.5),
        sleeve=wave(1, 0.8, 0.04), hand=wave(1, 1.6, 0.08), hair_x=wave(1, 5, 0.04), hair_y=wave(2, 1.5, 0.04),
    )
    eyes_blink(a, 30, half=False)
    return a


def sad():
    # Arms limp, head down, a slow sigh.
    a = Anim(
        48, 12,
        series=(("both_down", None),), elev=const(0), rests={"both_down": 0},
        hip_drop=const(10), knee=const(1.5), slump=plus(const(10), wave(1, 2.6)),
        nod=plus(const(15), wave(1, 2.2, 0.03)), head_squash=const(0.05), head_tilt=plus(const(-2), wave(1, 1, 0.05)),
        hip_x=wave(1, 3), hair_x=wave(1, 4, 0.05), hair_y=const(7),
    )
    a.eyes = ["sad"] * 48
    eyes_blink(a, 26, "closed", half=False)
    return a


def newbest():
    n = 26
    a = Anim(
        n, 24, loop=False,
        series=((None, 16), ("arm_low", None), ("arm_fore", 50), ("arm_mid", 75), ("arm_high", None), ("arm_star", None)),
        elev=track(n, (0, 16), (3, 10), (6, 30), (11, 150), (13, 182), (16, 170), (25, 174)),
        hip_drop=track(n, (0, 0), (3, 18), (7, 0), (12, -3), (16, 10), (20, 2), (25, 3)), knee=track(n, (0, 0), (3, 5), (7, 0), (16, 3), (25, 0)),
        lift=track(n, (0, 0), (5, 0), (10, 22), (14, 0), (25, 0)), lean=track(n, (0, 0), (11, 1.2), (25, 0.8)),
        head_tilt=track(n, (0, 0), (3, 1), (11, -3), (25, -2.5)), nod=track(n, (0, 0), (3, 5), (9, -3), (16, 5), (25, 0)),
        hair_x=track(n, (0, 0), (6, -6), (12, 10), (18, -5), (25, 0)), hair_y=track(n, (0, 0), (3, 5), (9, 12), (15, -8), (25, 0)),
    )
    eyes_shut(a, 10, None, "happy")
    return a


ANIMS = {
    "neutral": neutral, "vibe1": vibe1, "vibe2": vibe2, "vibe3": vibe3, "fever": fever, "miss": miss, "crushed": crushed,
    "milestone": milestone, "charting": charting, "emerge": emerge, "reveal": reveal, "stretch": stretch, "adjust": adjust,
    "peek": peek, "hype": hype, "go": go, "cheer": cheer, "okay": okay, "sad": sad, "newbest": newbest,
}
