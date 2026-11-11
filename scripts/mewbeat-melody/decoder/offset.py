"""How far the stored features and the stored audio of one song are apart: { offsetMs, confidence, ... } from the audio file and the
onsets of the features.

The Lavalink plugin fetches a track twice, once to analyse it (the features, and so the chart) and once to render the .ogg the player
hears, and the two fetches can differ by whole 20 ms chunks of leading content. offsetMs is that difference:

    offsetMs > 0  the stored features lie later than the same sounds in the stored audio (the chart is late against the music)
    offsetMs < 0  the audio has extra lead (the chart is early against the music)

so a note at chart time T is heard at audio time T - offsetMs.

The method: the plugin's LIGHT extractor (lavalink-plugins/mewbeat/.../dsp: Downsampler, FeatureExtractor) is written out here on
numpy, with its frames taken every STEP_SAMPLES (0.33 ms) instead of every 256. The stored onsets carry the spectral flux of the
analysed audio as their strength; the same flux measured on this audio, at the places the stored onsets would sit if the offset were D,
reproduces those strengths when D is right and is unrelated to them when it is not. The score of a D is the Pearson correlation between
the two, pooled over the four bands (weighted by their onset counts); the answer is the D with the best score. Nothing is tuned: the
scan is exact to 1 ms and was checked against the plugin's own extractor run on the delayed audio (docs/mewbeat/audio-offset-2026-11-11.md).

confidence = min(peak, 4 * margin), 0..1: peak is the best score, margin is how far it is above the best score of a D more than
CLEAR_MS away (a second, nearly as good place means the answer is not clear). The first WINDOW_S seconds are read; when the
confidence is under minConfidence the window grows to LONG_WINDOW_S before the answer is given.

Needs only numpy, soundfile and soxr (the decoder image has them); no scipy. Run in the mewbeat-decoder image, never on the host.
"""
import time

import numpy as np
import soundfile as sf

FFT = 1024
HOP = 256
RATE = 24000  # the extractor's rate after the half-band downsample of the 48 kHz stream
STEP_SAMPLES = 8  # 1 ms = 24 samples, so every whole millisecond of offset lands on this grid
EDGES = (20, 150, 800, 4000, 12000)
BAND_NAMES = ("low", "lowmid", "highmid", "high")

SEARCH_MS = 120  # offsets from -SEARCH_MS to +SEARCH_MS are tried (the measured ones lie between -65 and +40)
CLEAR_MS = 12  # a score closer than this to the best one is the same peak, not a competitor
WINDOW_S = 40
LONG_WINDOW_S = 90
MIN_ONSETS = 60  # fewer onsets in the window than this cannot say anything
MIN_BAND_ONSETS = 8
MIN_CONFIDENCE = 0.6


def band_bins():
    bins = []
    for index in range(4):
        start = max(1, int(np.ceil(EDGES[index] * FFT / RATE)))
        end = int(np.floor(EDGES[index + 1] * FFT / RATE)) if index == 3 else int(np.ceil(EDGES[index + 1] * FFT / RATE)) - 1
        bins.append((start, min(FFT // 2, end)))
    return bins


BANDS = band_bins()


def half_band_kernel():
    """The Downsampler's 79 taps: a half-band sinc under a Kaiser window (beta 8), normalised to a sum of 1."""
    taps = np.arange(79) - 39
    ideal = np.where(taps == 0, 0.5, np.sin(np.pi * taps / 2) / (np.pi * np.where(taps == 0, 1, taps)))
    window = np.i0(8.0 * np.sqrt(np.maximum(0.0, 1.0 - (taps / 39.0) ** 2))) / np.i0(8.0)
    kernel = ideal * window
    return kernel / kernel.sum()


KERNEL = half_band_kernel()
HANN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FFT) / FFT)).astype(np.float32)


def read_mono_24k(source, seconds):
    """The first `seconds` of the file as the extractor sees them: both channels averaged, 48 kHz, the half-band filter, every second sample."""
    with sf.SoundFile(source) as file:
        rate = file.samplerate
        pcm = file.read(frames=int(seconds * rate), dtype="float32", always_2d=True)
    mono = pcm.mean(axis=1)
    if rate != 48000:
        import soxr  # not needed for what the plugin renders, which is always 48 kHz

        mono = soxr.resample(mono, rate, 48000)
    return np.convolve(mono.astype(np.float64), KERNEL)[: len(mono)][::2].astype(np.float32)


def fine_flux(y, chunk=2048):
    """flux[band][j] for the frame that ends at sample FFT + j * STEP_SAMPLES, against the frame HOP samples earlier."""
    frames = np.lib.stride_tricks.sliding_window_view(y, FFT)[::STEP_SAMPLES]
    count = frames.shape[0]
    lag = HOP // STEP_SAMPLES
    scale = 2.0 / HANN.sum()
    out = np.zeros((4, count), np.float32)
    for a in range(lag, count, chunk):
        b = min(count, a + chunk)
        magnitude = np.abs(np.fft.rfft(frames[a - lag:b] * HANN, axis=1)) * scale
        compressed = np.log1p(1000.0 * magnitude).astype(np.float32)
        rise = np.maximum(compressed[lag:] - compressed[:-lag], 0)
        for band, (start, end) in enumerate(BANDS):
            out[band, a:b] = rise[:, start:end + 1].mean(axis=1)
    return out


def score_curve(flux, bands, window_ms):
    """Pooled correlation for every offset in -SEARCH_MS..+SEARCH_MS at 1 ms; None when the window holds too few onsets to say anything."""
    offsets = np.arange(-SEARCH_MS, SEARCH_MS + 1)
    total = np.zeros(len(offsets))
    weight = 0
    used = 0
    for band, onsets in enumerate(bands):
        t = np.asarray([row[0] for row in onsets], np.float64)
        s = np.asarray([row[1] for row in onsets], np.float64)
        keep = (t >= SEARCH_MS + 100) & (t <= window_ms - SEARCH_MS - 100)
        t, s = t[keep], s[keep]
        if len(t) < MIN_BAND_ONSETS or s.std() < 1e-9:
            continue
        end = (np.rint(t * RATE / 1000 / HOP).astype(np.int64) + 1) * HOP  # the stored frame end, in samples
        # the same sound sits 24 * D samples earlier in the audio when the features lie D ms later
        index = (end[None, :] - 24 * offsets[:, None] - FFT) // STEP_SAMPLES
        x = flux[band][index]
        x = x - x.mean(axis=1, keepdims=True)
        y = s - s.mean()
        norm = np.sqrt((x * x).sum(axis=1)) * np.sqrt((y * y).sum())
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.where(norm > 1e-12, (x @ y) / norm, 0.0)
        total += r * len(t)
        weight += len(t)
        used += len(t)
    if used < MIN_ONSETS:
        return None
    return offsets, total / weight, used


def summarize(offsets, curve):
    best = int(np.argmax(curve))
    far = np.abs(offsets - offsets[best]) > CLEAR_MS
    peak = float(curve[best])
    margin = peak - float(curve[far].max())
    return int(offsets[best]), peak, margin, float(np.clip(min(peak, 4 * margin), 0.0, 1.0))


def estimate(source, bands, min_confidence=MIN_CONFIDENCE, window_s=WINDOW_S, long_window_s=LONG_WINDOW_S):
    """source: a path or a file object of the audio; bands: the four lists of [t ms, strength] of the features' onsets, in BAND_NAMES order.

    -> { offsetMs, confidence, peak, margin, onsets, windowS, ms: { read, flux, score } }; offsetMs, confidence, peak and margin are
    None when the window held too few onsets to say anything."""
    times = {"read": 0.0, "flux": 0.0, "score": 0.0}
    result = None
    for seconds in sorted({window_s, long_window_s}):
        started = time.monotonic()
        y = read_mono_24k(source, seconds)
        if hasattr(source, "seek"):
            source.seek(0)  # a file object is read again for the longer window
        times["read"] += time.monotonic() - started
        started = time.monotonic()
        flux = fine_flux(y)
        times["flux"] += time.monotonic() - started
        started = time.monotonic()
        window = len(y) / RATE
        curve = score_curve(flux, bands, window * 1000)
        times["score"] += time.monotonic() - started
        result = {"offsetMs": None, "confidence": None, "peak": None, "margin": None, "onsets": 0, "windowS": round(window, 1)}
        if curve is not None:
            offsets, scores, used = curve
            offset, peak, margin, confidence = summarize(offsets, scores)
            result.update(offsetMs=offset, confidence=round(confidence, 3), peak=round(peak, 3), margin=round(margin, 3), onsets=used)
        if (result["confidence"] or 0) >= min_confidence or window < seconds - 1:  # clear enough, or the file has no more to read
            break
    result["ms"] = {name: round(value * 1000) for name, value in times.items()}
    return result


def bands_from_features(features):
    """The onsets of a features file ({ bands: [{ name, onsets: [{ t, s }] }] }) in BAND_NAMES order, as [[t, s], ...] lists."""
    by_name = {band["name"]: band["onsets"] for band in features["bands"]}
    return [[[o["t"], o["s"]] for o in by_name.get(name, [])] for name in BAND_NAMES]
