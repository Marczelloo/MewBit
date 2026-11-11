"""Self-check of offset.py and of the /offset endpoint of service.py, on audio made up here (no library data, no model). Run in Docker:

    docker run --rm --entrypoint python -v "<repo>/scripts/mewbeat-melody/decoder:/check:ro" mewbeat-decoder-svc:<tag> -I /check/check_offset.py

It runs the sources in the mounted folder, so it works on an image built before the change as well. The real validation against the plugin's
own extractor (the 34 songs of the audio-variants report) is scripts/mewbeat-melody/measure-offsets.js on the bot's data.
Exit code 0 when everything holds, 1 otherwise.
"""
import io
import json
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # -I leaves the script's own folder out
import numpy as np
import soundfile as sf
import offset as O

RATE = 48000
SECONDS = 50
failures = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (" " + detail if detail else ""), flush=True)
    if not ok:
        failures.append(name)


def make_audio(seed):
    """Drum-like stereo audio: decaying bursts, a low thump, a mid noise band and a bright hiss, at irregular times."""
    rng = np.random.RandomState(seed)
    n = RATE * SECONDS
    mono = np.zeros(n, np.float64)
    t = 0.4
    while t < SECONDS - 0.5:
        start = int(t * RATE)
        kind = rng.randint(3)
        length = int(RATE * (0.12 if kind else 0.2))
        envelope = np.exp(-np.arange(length) / (length / 5.0))
        if kind == 0:
            burst = np.sin(2 * np.pi * 70 * np.arange(length) / RATE) * envelope
        elif kind == 1:
            noise = rng.randn(length)
            burst = np.convolve(noise, np.ones(8) / 8, mode="same") * envelope
        else:
            burst = np.diff(rng.randn(length + 1)) * envelope * 0.5
        mono[start:start + length] += burst * (0.3 + 0.7 * rng.rand())
        t += 0.13 + 0.37 * rng.rand()
    mono += rng.randn(n) * 0.002
    return np.stack([mono, mono * 0.9], axis=1).astype(np.float32)


def wav_of(pcm):
    buffer = io.BytesIO()
    sf.write(buffer, pcm, RATE, format="WAV", subtype="FLOAT")
    return buffer.getvalue()


def shifted(pcm, delay_ms):
    """The audio delayed by delay_ms (extra lead of silence), or, when negative, with that much of its start cut off."""
    n = int(round(abs(delay_ms) * RATE / 1000))
    if delay_ms > 0:
        return np.concatenate([np.zeros((n, 2), np.float32), pcm])
    return pcm[n:] if delay_ms < 0 else pcm


def stored_onsets(pcm):
    """What the features of this audio would hold: the extractor's flux on its own 256-sample grid, a simple pick, strength = flux / p95."""
    flux = O.fine_flux(O.read_mono_24k(io.BytesIO(wav_of(pcm)), SECONDS))
    bands = []
    for band in range(4):
        grid = flux[band, ::O.HOP // O.STEP_SAMPLES]  # the plugin's frames: ends at 1024 + 256 k
        reference = np.percentile(grid[grid > 0.02], 95) if (grid > 0.02).any() else 1.0
        rows = []
        last = -10
        for k in range(2, len(grid) - 2):
            v = grid[k]
            if v > 0.2 * reference and v >= grid[k - 2:k + 3].max() and k - last >= 5:
                # frame k ends at sample 1024 + 256 k = (hop + 1) * 256 with hop = k + 3; its time is hop * 256 / 24 ms
                rows.append([round((k + 3) * O.HOP * 1000 / O.RATE), round(float(min(1.0, v / reference)), 3)])
                last = k
        bands.append(rows)
    return bands


def post(port, path, body):
    request = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=body, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main():
    audio = make_audio(1)
    bands = stored_onsets(audio)
    check("the made-up features hold onsets in every band", all(len(rows) > 50 for rows in bands), str([len(r) for r in bands]))

    # offsetMs > 0: the stored features lie later than the sounds in the audio. Delaying the audio by d ms (extra lead) makes the
    # features EARLIER than the music: the offset moves by -d. A cut-off start (negative d) moves it the other way.
    for delay in (0, 20, 35, -20, -47):
        result = O.estimate(io.BytesIO(wav_of(shifted(audio, delay))), bands)
        check("audio delayed by %+d ms -> offsetMs %+d" % (delay, -delay), result["offsetMs"] is not None and abs(result["offsetMs"] + delay) <= 3,
              "got %s, confidence %s" % (result["offsetMs"], result["confidence"]))
        check("  confident (>= %.1f)" % O.MIN_CONFIDENCE, (result["confidence"] or 0) >= O.MIN_CONFIDENCE, str(result["confidence"]))

    other = O.estimate(io.BytesIO(wav_of(make_audio(2))), bands)
    check("other audio against these features is not confident", (other["confidence"] or 0) < O.MIN_CONFIDENCE, str(other["confidence"]))

    noisy = audio + np.random.RandomState(5).randn(*audio.shape).astype(np.float32) * 0.02
    result = O.estimate(io.BytesIO(wav_of(shifted(noisy, 20))), bands)
    check("noise on the audio keeps the answer", result["offsetMs"] is not None and abs(result["offsetMs"] + 20) <= 3, str(result["offsetMs"]))

    few = O.estimate(io.BytesIO(wav_of(audio)), [rows[:5] for rows in bands])
    check("too few onsets -> no answer", few["offsetMs"] is None and few["confidence"] is None, str(few["offsetMs"]))

    port = 8099
    env = dict(os.environ, MEWBEAT_DECODER_PORT=str(port), MEWBEAT_DECODER_MAX_MB="50")
    service = subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "service.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=1).read()
                break
            except OSError:
                time.sleep(0.1)
        head = json.dumps({"bands": dict(zip(O.BAND_NAMES, bands)), "minConfidence": 0.6}).encode()
        body = struct.pack(">I", len(head)) + head + wav_of(shifted(audio, 20))
        status, answer = post(port, "/offset", body)
        check("POST /offset answers 200 with the same offset", status == 200 and abs(answer.get("offsetMs", 99) + 20) <= 3, str(answer))
        check("  and reports a confidence and its timings", isinstance(answer.get("confidence"), float) and "ms" in answer, str(answer))
        status, answer = post(port, "/offset", struct.pack(">I", 10) + b"not json!!" + b"x" * 100)
        check("POST /offset with a body that is not JSON -> 400 permanent", status == 400 and answer.get("permanent") is True, str(answer))
        status, answer = post(port, "/offset", struct.pack(">I", len(head)) + head + b"this is not audio at all" * 20)
        check("POST /offset with audio that cannot be read -> 400 permanent", status == 400 and answer.get("permanent") is True, str(answer))
        status, answer = post(port, "/offset", b"abc")
        check("POST /offset with a body too short -> 400", status == 400, str(answer))
        status, answer = post(port, "/nothing", b"x")
        check("another path -> 404", status == 404, str(answer))
        health = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=5).read())
        check("the model was not loaded by the offset requests", health.get("loaded") is False, str(health))
    finally:
        service.terminate()
        try:
            service.wait(timeout=10)
        except subprocess.TimeoutExpired:
            service.kill()

    print("%d failure(s)" % len(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
