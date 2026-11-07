"""Basic Pitch ONNX inference: audio file -> note, onset and contour posteriors at 86.13 frames a second.

Windowing and stitching follow basic_pitch.inference, except that the kept frames are put on a uniform grid (see infer).
The posteriors are kept as uint8 (x 255) and read back as floats, the way the first hand-run decodes stored them: the notes
that follow depend on those quantised values, so a decode now repeats an earlier one.
"""
import numpy as np

MODEL = "/opt/venv/lib/python3.12/site-packages/basic_pitch/saved_models/icassp_2022/nmp.onnx"
SR, HOP, N = 22050, 256, 22050 * 2 - 256
OLAP = 30  # frames, same as the package
FPS = SR / HOP


def load(path):
    import librosa
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32)


def session(threads=1):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    return ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"])


def infer(sess, y):
    """Same windowing as basic_pitch.inference: hop N - overlap, half of the overlap cut on each side."""
    olap = OLAP * HOP
    hop = N - olap
    pad = np.concatenate([np.zeros(olap // 2, np.float32), y])
    name = sess.get_inputs()[0].name
    outs = {"note": [], "onset": [], "contour": []}
    onames = [o.name for o in sess.get_outputs()]
    for i in range(0, len(pad), hop):
        w = pad[i:i + N]
        if len(w) < N:
            w = np.pad(w, (0, N - len(w)))
        r = sess.run(onames, {name: w[None, :, None]})
        d = dict(zip(onames, r))
        outs["contour"].append(d["StatefulPartitionedCall:0"][0])
        outs["note"].append(d["StatefulPartitionedCall:1"][0])
        outs["onset"].append(d["StatefulPartitionedCall:2"][0])
    # A window holds 172 frames over 43844 samples and advances 36164 samples while 142 frames are kept: stitched frames run at
    # 86.58 fps, not 86.13. Treating them as uniform drifts .52% (half a second at 100 s). Put each kept frame on a uniform grid.
    n_keep = int(np.floor(len(y) * (FPS / SR)))
    k = OLAP // 2
    keep = {m: np.concatenate([a[k:-k] for a in v]) for m, v in outs.items()}
    n = len(keep["note"])
    n_kept = 172 - OLAP
    samples = (np.arange(n) // n_kept) * hop + (np.arange(n) % n_kept) * HOP
    idx = np.round(samples / HOP).astype(int)
    res = {}
    for m, a in keep.items():
        o = np.zeros((max(n_keep, idx.max() + 1), a.shape[1]), np.float32)
        np.maximum.at(o, idx, a)
        res[m] = o[:n_keep]
    return res


def posteriors(path, threads=1):
    """(note, onset, contour, duration in s) for one audio file."""
    y = load(path)
    o = infer(session(threads), y)
    q = {m: (o[m] * 255).astype(np.uint8) / 255. for m in ("note", "onset", "contour")}
    return q["note"], q["onset"], q["contour"], len(y) / SR
