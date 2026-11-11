"""The melody decoder as a service: the bot POSTs the bytes of an audio file and gets the JSON decode.py writes back.

    python -I service.py

    POST /decode   body: the audio file         -> 200 { dur, notes, fg, short } (the text decode.py writes to its output file)
    POST /offset   body: 4 bytes (big endian) N, N bytes of JSON { bands: { low, lowmid, highmid, high: [[t ms, strength], ...] },
                   minConfidence? }, then the audio file          -> 200 { offsetMs, confidence, peak, margin, onsets, windowS, ms }
                   (offset.py: how far the audio the player hears and the features the chart came from are apart; no model is loaded)
    GET  /health   -> 200 { ok, loaded, busy, queued, threads, idleUnloadS }

Failures (of both) answer { error, permanent }: 400 audio that cannot be read or a body that is not what /offset takes (permanent: the same bytes fail again), 413 a body over
MEWBEAT_DECODER_MAX_MB (permanent), 503 the queue is full or the request waited longer than its X-Timeout-Ms (transient), 500 any other
error in the decode, a lack of memory among them (transient). A decode that is killed from outside (the container out of memory)
shows to the caller as a closed connection.

Decodes run one at a time, in the order they came, on one worker thread; a request waits for its turn with its connection open.
The Basic Pitch session is made on the first decode and let go after MEWBEAT_DECODER_IDLE_MIN minutes without one (and the memory
returned to the system), so an idle service holds little. MEWBEAT_DECODER_THREADS caps the inference threads (the review measured
that four scale poorly and two is the target on the Pi 5).

Environment: MEWBEAT_DECODER_PORT (8090), MEWBEAT_DECODER_THREADS (2), MEWBEAT_DECODER_IDLE_MIN (5), MEWBEAT_DECODER_MAX_MB (200),
MEWBEAT_DECODER_MAX_QUEUE (4 decodes waiting behind the one running).
"""
import ctypes
import gc
import io
import json
import os
import queue
import signal
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script's own folder out
os.environ.setdefault("OMP_NUM_THREADS", "1")
import bp
import decode
import offset

PORT = int(os.environ.get("MEWBEAT_DECODER_PORT", "8090"))
THREADS = max(1, int(os.environ.get("MEWBEAT_DECODER_THREADS", "2")))
IDLE_S = float(os.environ.get("MEWBEAT_DECODER_IDLE_MIN", "5")) * 60
MAX_BYTES = int(float(os.environ.get("MEWBEAT_DECODER_MAX_MB", "200")) * 1024 * 1024)
MAX_QUEUE = max(0, int(os.environ.get("MEWBEAT_DECODER_MAX_QUEUE", "4")))


def log(message):
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}", flush=True)


def give_memory_back():
    """gc, then glibc hands the freed heap back to the system (the session's arena is not returned by free alone)."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


class Job:
    def __init__(self, body, expires, kind="decode"):
        self.kind = kind  # "decode" or "offset"
        self.body = body
        self.expires = expires  # monotonic time after which nobody waits for the answer, or None
        self.done = threading.Event()
        self.status = 500
        self.payload = b""
        self.headers = {}


class Decoder:
    """One worker thread decodes the queued jobs; the session lives between them and is dropped when the service has been idle."""

    def __init__(self):
        self.jobs = queue.Queue()
        self.waiting = 0  # jobs in the queue, not the one running
        self.lock = threading.Lock()
        self.sess = None
        self.busy = False
        self.used_at = time.monotonic()
        threading.Thread(target=self.work, daemon=True, name="decoder").start()

    def submit(self, job):
        with self.lock:
            if self.waiting >= MAX_QUEUE and (self.busy or self.waiting):
                return False
            self.waiting += 1
        self.jobs.put(job)
        return True

    def state(self):
        return {"ok": True, "loaded": self.sess is not None, "busy": self.busy, "queued": self.waiting, "threads": THREADS, "idleUnloadS": IDLE_S}

    def work(self):
        while True:
            try:
                job = self.jobs.get(timeout=1)
            except queue.Empty:
                if self.sess is not None and time.monotonic() - self.used_at >= IDLE_S:
                    self.sess = None
                    give_memory_back()
                    log("idle: the model is unloaded")
                continue
            with self.lock:
                self.waiting -= 1
                self.busy = True
            try:
                self.run(job)
            finally:
                self.busy = False
                self.used_at = time.monotonic()
                job.done.set()

    def run(self, job):
        if job.expires is not None and time.monotonic() > job.expires:
            self.fail(job, 503, "the request waited past its timeout", False)
            return
        started = time.monotonic()
        try:
            if job.kind == "offset":
                self.run_offset(job, started)
                return
            loaded_ms = 0
            if self.sess is None:
                self.sess = bp.session(THREADS)
                loaded_ms = round((time.monotonic() - started) * 1000)
                log(f"model loaded in {loaded_ms} ms")
            result = decode.decode(io.BytesIO(job.body), THREADS, self.sess)
            job.status = 200
            job.payload = json.dumps(result).encode()
            took = round((time.monotonic() - started) * 1000)
            job.headers = {"X-Decode-Ms": str(took), "X-Model-Load-Ms": str(loaded_ms)}
            log(f"decoded {len(job.body)} bytes in {took} ms: notes {len(result['notes'])} fg {len(result['fg'])} short {len(result['short'])}")
        except (ValueError, RuntimeError, OSError) as error:
            # soundfile's LibsndfileError is a RuntimeError, the numpy and soxr checks raise ValueError: audio that cannot be read
            what = "the audio cannot be decoded" if job.kind == "decode" else "the offset request cannot be used"
            self.fail(job, 400, f"{what}: {str(error).split(': ', 1)[-1]}", True)  # drop the file object's repr
        except MemoryError:
            self.sess = None
            give_memory_back()
            self.fail(job, 500, "out of memory", False)
        except Exception as error:  # noqa: BLE001 - whatever it is, the caller gets an answer and the worker lives on
            self.fail(job, 500, f"{type(error).__name__}: {error}", False)
        finally:
            job.body = b""
            gc.collect()

    @staticmethod
    def run_offset(job, started):
        """offset.estimate on the audio of the body; the Basic Pitch session is not touched (nor made)."""
        body = job.body
        if len(body) < 4:
            raise ValueError("the body is too short")
        (head,) = struct.unpack(">I", body[:4])
        if head <= 0 or 4 + head >= len(body):
            raise ValueError("the body holds no audio after its JSON")
        request = json.loads(body[4:4 + head])
        bands = request.get("bands")
        if not isinstance(bands, dict):
            raise ValueError("the JSON has no bands")
        listed = [bands.get(name) for name in offset.BAND_NAMES]
        if not all(isinstance(rows, list) for rows in listed):
            raise ValueError("the bands must be lists of [t, strength]")
        minimum = request.get("minConfidence", offset.MIN_CONFIDENCE)
        if not isinstance(minimum, (int, float)):
            raise ValueError("minConfidence must be a number")
        result = offset.estimate(io.BytesIO(body[4 + head:]), listed, float(minimum))
        job.status = 200
        job.payload = json.dumps(result).encode()
        took = round((time.monotonic() - started) * 1000)
        job.headers = {"X-Offset-Ms": str(took)}
        log(f"offset of {len(body) - 4 - head} bytes in {took} ms: {result['offsetMs']} ms, confidence {result['confidence']}")

    @staticmethod
    def fail(job, status, message, permanent):
        log(f"{job.kind} failed ({status}): {message}")
        job.status = status
        job.payload = json.dumps({"error": message, "permanent": permanent}).encode()


decoder = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mewbeat-decoder"

    def reply(self, status, payload, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def error(self, status, message, permanent):
        self.close_connection = True
        self.reply(status, json.dumps({"error": message, "permanent": permanent}).encode())

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, json.dumps(decoder.state()).encode())
        else:
            self.error(404, "not found", True)

    def do_POST(self):
        kind = {"/decode": "decode", "/offset": "offset"}.get(self.path)
        if kind is None:
            return self.error(404, "not found", True)
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.error(411, "Content-Length is required", True)
        if length <= 0:
            return self.error(400, "the body is empty", True)
        if length > MAX_BYTES:
            return self.error(413, f"the body is over {MAX_BYTES} bytes", True)
        expires = None
        try:
            expires = time.monotonic() + int(self.headers.get("X-Timeout-Ms", "")) / 1000
        except ValueError:
            pass  # no header or not a number: the job waits as long as it takes
        body = self.rfile.read(length)
        if len(body) != length:
            return self.error(400, "the body ended early", False)
        job = Job(body, expires, kind)
        if not decoder.submit(job):
            return self.error(503, "the queue is full", False)
        job.done.wait()
        self.reply(job.status, job.payload, job.headers)

    def log_message(self, *args):
        pass  # decode lines are logged by the worker


def main():
    global decoder
    decoder = Decoder()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    # PID 1 in a container gets no default handler for SIGTERM: without this `docker stop` waits out its timeout and kills.
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    log(f"mewbeat decoder listening on {PORT}, {THREADS} thread(s), model unloaded after {IDLE_S / 60:g} min idle")
    server.serve_forever()
    log("stopped")


if __name__ == "__main__":
    main()
