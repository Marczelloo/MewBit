"""osu! beatmap files as data: safe .osz reading, .osu (mania) parsing and the timing grid of a map.

Downloaded files are untrusted input. Nothing here executes or evaluates their content; an .osz is read member by
member with size limits, never extracted with extractall, and only .osu text and the audio file it names are used.
"""

from __future__ import annotations

import hashlib
import math
import zipfile
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

MAX_MEMBERS = 2000
MAX_OSU_BYTES = 8 * 1024 * 1024
MAX_AUDIO_BYTES = 80 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".ogg", ".wav", ".flac", ".m4a", ".opus"}

# Divisors a note may be snapped to, coarsest first. 1/12 and 1/16 are kept so that "unsnapped" really means off-grid.
DIVISORS = (1, 2, 3, 4, 6, 8, 12, 16)
SNAP_TOLERANCE_MS = 2.5  # the editor stores integer ms; rounding and old maps' float drift stay inside this


# --- .osz --------------------------------------------------------------------------------------------------------


def _member_ok(info: zipfile.ZipInfo) -> bool:
    name = PurePosixPath(info.filename.replace("\\", "/"))
    return not info.is_dir() and not name.is_absolute() and ".." not in name.parts


def read_osz(path: Path) -> tuple[dict[str, str], dict[str, zipfile.ZipInfo]]:
    """Returns ({member name: .osu text}, {lower-case member name: ZipInfo of every safe member})."""
    osu: dict[str, str] = {}
    members: dict[str, zipfile.ZipInfo] = {}
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if len(infos) > MAX_MEMBERS:
            raise ValueError(f"{path.name}: too many members ({len(infos)})")
        for info in infos:
            if not _member_ok(info):
                continue
            members[info.filename.replace("\\", "/").lower()] = info
            if info.filename.lower().endswith(".osu"):
                if info.file_size > MAX_OSU_BYTES:
                    raise ValueError(f"{path.name}: {info.filename} too large")
                osu[info.filename] = z.read(info).decode("utf-8-sig", errors="replace")
    return osu, members


def copy_audio(osz: Path, members: dict[str, zipfile.ZipInfo], audio_name: str, out_dir: Path) -> Path | None:
    """Copies the named audio member to out_dir/<sha1><ext> (a name that cannot carry a path) and returns it."""
    info = members.get(audio_name.replace("\\", "/").lower())
    if info is None:
        return None
    ext = PurePosixPath(info.filename).suffix.lower()
    if ext not in AUDIO_EXTENSIONS or info.file_size > MAX_AUDIO_BYTES:
        return None
    with zipfile.ZipFile(osz) as z:
        data = z.read(info)
    if len(data) > MAX_AUDIO_BYTES:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{hashlib.sha1(data).hexdigest()}{ext}"
    if not target.exists():
        target.write_bytes(data)
    return target


# --- .osu ----------------------------------------------------------------------------------------------------------


@dataclass
class TimingPoint:
    t: float
    beat_length: float
    meter: int
    uninherited: bool
    kiai: bool


@dataclass
class Note:
    t: int
    lane: int
    end: int | None = None  # hold end (ms), None for a tap

    @property
    def is_hold(self) -> bool:
        return self.end is not None and self.end > self.t


@dataclass
class Beatmap:
    general: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, str] = field(default_factory=dict)
    difficulty: dict[str, str] = field(default_factory=dict)
    timing: list[TimingPoint] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)
    breaks: list[tuple[int, int]] = field(default_factory=list)
    format_version: int | None = None

    @property
    def mode(self) -> int:
        return int(self.general.get("Mode", "0") or 0)

    @property
    def keys(self) -> int:
        return int(round(float(self.difficulty.get("CircleSize", "0") or 0)))

    @property
    def beatmap_id(self) -> int | None:
        v = self.metadata.get("BeatmapID")
        return int(v) if v and v.lstrip("-").isdigit() and int(v) > 0 else None

    @property
    def version(self) -> str:
        return self.metadata.get("Version", "")

    @property
    def audio_filename(self) -> str:
        return self.general.get("AudioFilename", "").strip()


def parse_osu(text: str) -> Beatmap:
    bm = Beatmap()
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("osu file format v"):
            try:
                bm.format_version = int(line.rsplit("v", 1)[1])
            except ValueError:
                pass
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if section in ("General", "Metadata", "Difficulty"):
            if ":" in line:
                k, v = line.split(":", 1)
                getattr(bm, section.lower())[k.strip()] = v.strip()
        elif section == "Events":
            parts = line.split(",")
            if parts[0] in ("2", "Break") and len(parts) >= 3:
                try:
                    bm.breaks.append((int(float(parts[1])), int(float(parts[2]))))
                except ValueError:
                    pass
        elif section == "TimingPoints":
            parts = line.split(",")
            if len(parts) < 2:
                continue
            try:
                t = float(parts[0])
                beat_length = float(parts[1])
            except ValueError:
                continue
            meter = int(parts[2]) if len(parts) > 2 and parts[2].strip().lstrip("-").isdigit() else 4
            uninherited = (parts[6].strip() == "1") if len(parts) > 6 else beat_length > 0
            effects = int(parts[7]) if len(parts) > 7 and parts[7].strip().isdigit() else 0
            bm.timing.append(TimingPoint(t, beat_length, meter if meter > 0 else 4, uninherited, bool(effects & 1)))
        elif section == "HitObjects":
            parts = line.split(",")
            if len(parts) < 4:
                continue
            try:
                x = float(parts[0])
                t = int(float(parts[2]))
                kind = int(parts[3])
            except ValueError:
                continue
            keys = max(1, bm.keys)
            lane = min(keys - 1, max(0, int(math.floor(x * keys / 512))))
            end = None
            if kind & 128 and len(parts) > 5:
                try:
                    end = int(float(parts[5].split(":", 1)[0]))
                except ValueError:
                    end = None
            bm.notes.append(Note(t, lane, end))
    bm.notes.sort(key=lambda n: (n.t, n.lane))
    bm.timing.sort(key=lambda p: (p.t, not p.uninherited))
    return bm


def shifted(bm: Beatmap, ms: float) -> Beatmap:
    """A copy of the beatmap with every time moved by `ms` (notes, hold ends, timing points, breaks): the map moved
    from the osu! timeline onto the timeline of the decoded audio (audio_metrics.estimate_offset)."""
    off = int(round(ms))
    out = Beatmap(dict(bm.general), dict(bm.metadata), dict(bm.difficulty), format_version=bm.format_version)
    out.timing = [TimingPoint(p.t + ms, p.beat_length, p.meter, p.uninherited, p.kiai) for p in bm.timing]
    out.notes = [Note(n.t + off, n.lane, n.end + off if n.end is not None else None) for n in bm.notes]
    out.breaks = [(a + off, b + off) for a, b in bm.breaks]
    return out


# --- timing grid ---------------------------------------------------------------------------------------------------


class TimingGrid:
    """The map's own rhythm grid from its uninherited (red) timing points.

    A red line starts a new beat grid and a new bar (osu! resets the measure there). Beat positions are cumulative
    over the whole map, so a gap in beats is meaningful across BPM changes.
    """

    def __init__(self, timing: list[TimingPoint]):
        reds = [p for p in timing if p.uninherited and p.beat_length > 0]
        if not reds:
            raise ValueError("map has no uninherited timing point")
        # Two red lines at one time: the later one in the file wins (osu! behaviour).
        dedup: dict[float, TimingPoint] = {}
        for p in reds:
            dedup[p.t] = p
        self.reds = [dedup[t] for t in sorted(dedup)]
        self.starts = [p.t for p in self.reds]
        self.beat_offsets = [0.0]
        for a, b in zip(self.reds, self.reds[1:]):
            self.beat_offsets.append(self.beat_offsets[-1] + (b.t - a.t) / a.beat_length)
        greens = sorted(timing, key=lambda p: p.t)
        self.kiai_spans = _kiai_spans(greens)

    def _segment(self, t: float) -> int:
        return max(0, bisect_right(self.starts, t) - 1)

    def beat_ms(self, t: float) -> float:
        return self.reds[self._segment(t)].beat_length

    def bpm(self, t: float) -> float:
        return 60000.0 / self.beat_ms(t)

    def meter(self, t: float) -> int:
        return self.reds[self._segment(t)].meter

    def beat_pos(self, t: float) -> float:
        i = self._segment(t)
        p = self.reds[i]
        return self.beat_offsets[i] + (t - p.t) / p.beat_length

    def time_at(self, pos: float) -> float:
        i = max(0, bisect_right(self.beat_offsets, pos) - 1)
        p = self.reds[i]
        return p.t + (pos - self.beat_offsets[i]) * p.beat_length

    def local_pos(self, t: float) -> tuple[float, int]:
        """(beats since the segment's red line, segment index)."""
        i = self._segment(t)
        p = self.reds[i]
        return (t - p.t) / p.beat_length, i

    def snap(self, t: float, tolerance_ms: float = SNAP_TOLERANCE_MS) -> int | None:
        """The coarsest divisor d (1/d of a beat) that t sits on, or None when it is off every grid in DIVISORS."""
        pos, i = self.local_pos(t)
        L = self.reds[i].beat_length
        for d in DIVISORS:
            if abs(pos * d - round(pos * d)) * L / d <= tolerance_ms:
                return d
        return None

    def beat_in_bar(self, t: float) -> float:
        pos, i = self.local_pos(t)
        m = self.reds[i].meter
        return pos - math.floor(pos / m + 1e-9) * m

    def is_downbeat(self, t: float, tolerance_ms: float = SNAP_TOLERANCE_MS) -> bool:
        pos, i = self.local_pos(t)
        m = self.reds[i].meter
        L = self.reds[i].beat_length
        return abs(pos / m - round(pos / m)) * m * L <= tolerance_ms

    def beats(self, from_ms: float, to_ms: float, div: int = 1) -> list[float]:
        """Grid points of 1/div beat in [from_ms, to_ms), per segment (a red line restarts the grid)."""
        out: list[float] = []
        for i, p in enumerate(self.reds):
            seg_end = self.reds[i + 1].t if i + 1 < len(self.reds) else math.inf
            lo, hi = max(from_ms, p.t if i > 0 else -math.inf), min(to_ms, seg_end)
            if lo >= hi:
                continue
            step = p.beat_length / div
            k = math.ceil((lo - p.t) / step - 1e-9)
            while True:
                t = p.t + k * step
                if t >= hi:
                    break
                out.append(t)
                k += 1
        return out

    def in_kiai(self, t: float) -> bool:
        return any(a <= t < b for a, b in self.kiai_spans)

    @property
    def is_variable(self) -> bool:
        lengths = {round(p.beat_length, 3) for p in self.reds}
        return len(lengths) > 1

    @property
    def meters(self) -> set[int]:
        return {p.meter for p in self.reds}


def _kiai_spans(points: list[TimingPoint]) -> list[tuple[float, float]]:
    spans, start = [], None
    for p in points:
        if p.kiai and start is None:
            start = p.t
        elif not p.kiai and start is not None:
            if p.t > start:
                spans.append((start, p.t))
            start = None
    if start is not None:
        spans.append((start, math.inf))
    return spans


def main_bpm(grid: TimingGrid, first_ms: float, last_ms: float) -> float:
    """BPM covering the most time between first_ms and last_ms (what osu! shows as the main BPM)."""
    share: dict[float, float] = {}
    for i, p in enumerate(grid.reds):
        a = max(first_ms, p.t if i > 0 else first_ms)
        b = min(last_ms, grid.reds[i + 1].t if i + 1 < len(grid.reds) else last_ms)
        if b > a:
            bpm = round(60000.0 / p.beat_length, 2)
            share[bpm] = share.get(bpm, 0.0) + (b - a)
    return max(share, key=share.get) if share else 60000.0 / grid.reds[0].beat_length
