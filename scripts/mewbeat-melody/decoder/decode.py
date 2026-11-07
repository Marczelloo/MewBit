"""One audio file -> one JSON with what scripts/mewbeat-melody/build.js needs to make its melody file.

    python -I decode.py [--threads N] <audio file> <out json>

The JSON is { dur, notes, fg, short }: dur in s; notes as in notes.py, rounded to 3 decimals; fg the indices of the foreground line
in notes; short the notes under 600 ms of a second run at a lower onset threshold, [t, len, midi, vel] (a quiet line under a loud bed).
Run in the mewbeat-decoder image (helpers/mewbeat/melodyDecoder.js), never on the host.
"""
import argparse, json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script's own folder out
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np
import bp
import notes


def decode(path, threads=1):
    note, onset, contour, dur = bp.posteriors(path, threads)
    rows = notes.notes_of(note, onset, contour, notes.P, 0)
    fg = notes.foreground(rows)
    low = notes.notes_of(note, onset, contour, notes.P_LOW, 0)
    short = [[round(r[0]), round(r[1]), int(r[2]), round(float(r[3]), 2)] for r in low if r[1] < notes.SHORT_MS]
    return {"dur": dur, "notes": np.round(rows, 3).tolist(), "fg": [int(x) for x in fg], "short": short}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("audio")
    ap.add_argument("out")
    a = ap.parse_args()
    result = decode(a.audio, a.threads)
    temp = a.out + ".tmp"
    with open(temp, "w") as f:
        json.dump(result, f)
    os.replace(temp, a.out)
    print(f"notes {len(result['notes'])} fg {len(result['fg'])} short {len(result['short'])}", flush=True)


if __name__ == "__main__":
    main()
