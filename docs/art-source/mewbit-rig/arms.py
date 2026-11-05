"""An arm on two bones: a key drawing bends toward where the next key has it, so a raise is one line of motion and the sleeve stretches at the jacket instead of tearing off it."""
import numpy as np

from rig import rotate, smooth, smoothstep

SIGN = {"L": 1, "R": -1}
# How far from the jacket the sleeve takes to catch up with its bone, and how wide the bones trade over at the elbow.
STRETCH = 45
ELBOW_BLEND = 60
OVER_STRETCH = 60


def toward(a, b, s):
    """From vector a to vector b by the short way round, length and angle apart."""
    la, lb = np.hypot(*a), np.hypot(*b)
    ta, tb = np.arctan2(a[1], a[0]), np.arctan2(b[1], b[0])
    turn = (tb - ta + np.pi) % (2 * np.pi) - np.pi
    length, theta = la + (lb - la) * s, ta + turn * s
    return np.array((length * np.cos(theta), length * np.sin(theta)))


def between(k, n, s):
    k, n = [np.array(j, np.float64) for j in k], [np.array(j, np.float64) for j in n]
    root = k[0] + (n[0] - k[0]) * s
    elbow = root + toward(k[1] - k[0], n[1] - n[0], s)
    return root, elbow, elbow + toward(k[2] - k[1], n[2] - n[1], s)


def turned(joints, degrees):
    joints = [np.array(j, np.float64) for j in joints]
    return (joints[0], rotate(joints[1], degrees, joints[0]), rotate(joints[2], degrees, joints[0]))


def segment_distance(q, a, b):
    ab = b - a
    along = np.clip(((q - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.hypot(*np.moveaxis(q - (a + along[..., None] * ab), -1, 0))


def along_bone(q, a, b, rest_a, rest_b):
    """Back through a bone: it turns and stretches along its length, the sleeve keeps its width and whatever lies past the end stays rigid."""
    length, rest = np.hypot(*(b - a)), np.hypot(*(rest_b - rest_a))
    u, rest_u = (b - a) / length, (rest_b - rest_a) / rest
    d = q - a
    x, y = d @ u, d @ np.array((-u[1], u[0]))
    x = np.where(x < 0, x, np.where(x < length, x * rest / length, rest + x - length))
    return rest_a + x[..., None] * rest_u + y[..., None] * np.array((-rest_u[1], rest_u[0]))


def back_map(src, dst, clearance=None):
    """Where a key's pixels for each spot of the bent arm come from. `clearance` is the distance to what the arm stays attached to; without it the arm hangs on its shoulder alone."""
    src = [np.array(j, np.float64) for j in src]
    dst = [np.array(j, np.float64) for j in dst]

    def back(q):
        if all(np.abs(a - b).max() < 1e-6 for a, b in zip(src, dst)):
            return q
        fore = smooth((segment_distance(q, dst[0], dst[1]) - segment_distance(q, dst[1], dst[2])) / ELBOW_BLEND + 0.5)
        p = along_bone(q, dst[0], dst[1], src[0], src[1]) * (1 - fore)[..., None] + along_bone(q, dst[1], dst[2], src[1], src[2]) * fore[..., None]
        if clearance is None:
            loose = smoothstep(np.hypot(*np.moveaxis(q - dst[0], -1, 0)), 0, OVER_STRETCH)
        else:
            loose = smoothstep(clearance(q), 0, STRETCH)
        loose = 1 - (1 - loose) * (1 - fore)
        return q * (1 - loose)[..., None] + p * loose[..., None]

    return back
