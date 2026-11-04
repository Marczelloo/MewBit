# The blind listening test of stage 1: Normal moments per foreground variant, at the same budget.
# In mewbeat-ma: /scripts = the salience dir with feat/, /repo = the repository (read only),
# /out = .mewbeat-debug, /listening = this dir.
import json, os, pickle, random, sys

import numpy as np
import librosa
from scipy.stats import rankdata
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, "/scripts")
sys.path.insert(0, "/listening")
from common import load, rank_cols
from selection import select

DATA = "/repo/.mewbeat-debug/data"
HD = "toby-fox-hopes-and-dreams-undertale"
SONGS = [
    {"song": "hopes-and-dreams", "title": "Toby Fox: Hopes and Dreams", "id": None, "audioId": f"preview:{HD}",
     "audio": f"/repo/.mewbeat-preview/{HD}.pcm.wav", "pkl": "/scripts/feat/hd.pkl"},
    {"song": "flower-dance", "title": "DJ OKAWARI: Flower Dance", "id": "476691"},
    {"song": "yoru-ni-kakeru", "title": "YOASOBI: Yoru ni Kakeru", "id": "1374931"},
    {"song": "mizuoto", "title": "MIMI: Mizuoto to Curtain", "id": "2045473"},
]
HD_PARTS = [(0, "skrzypce"), (20000, "szybka sekwencja z gitarą"), (22000, "główna melodia"), (45000, "sama gitara"),
            (67000, "gitara z melodią"), (79000, "gitara z dzwonkiem lub fletem"), (90000, "głównie melodia i flet"), (112000, "bez opisu")]
BASE_FEATURES = ["rel_os", "m_beat", "m_half", "m_quarter", "m_other", "m_down", "d_grid"]
DEFAULT_RATE = 1.485  # the median Normal moments per beat on train; used where no human chart exists
LEAD_GAP = 40
VARIANTS = ["A", "B", "C", "K"]
SEED = 20261104


def fit_base():
    songs = [s for s in load() if "normal" in s["label"]]
    X, y = [], []
    for s in songs:
        idx = [s["names"].index(n) for n in BASE_FEATURES]
        X.append(s["Xr"][:, idx])
        y.append(s["label"]["normal"])
    model = LogisticRegression(max_iter=2000).fit(np.vstack(X), np.concatenate(y))
    print("base", len(songs), "songs", dict(zip(BASE_FEATURES, np.round(model.coef_[0], 2))), flush=True)
    return model


def contour(y, sr, n_fft=2048, hop=256):
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    H, _ = librosa.decompose.hpss(S, margin=2.0)
    fb = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    midi = np.arange(55, 97)
    Hn = H / (H.max(0, keepdims=True) + 1e-9)
    sal = np.zeros((midi.size, H.shape[1]))
    for m, f in enumerate(librosa.midi_to_hz(midi)):
        for h, w in enumerate([1.0, 0.8, 0.64, 0.51, 0.41]):
            if f * (h + 1) < sr / 2:
                sal[m] += w * Hn[np.argmin(np.abs(fb - f * (h + 1)))] ** 0.5
    return midi[sal.argmax(0)], sal.max(0) / (np.median(sal, axis=0) + 1e-9), sr / hop


def note_starts(pitch, conf, fps, min_ms, tol=1, floor=2.0):
    out, s = [], 0
    for i in range(1, pitch.size + 1):
        if i == pitch.size or abs(int(pitch[i]) - int(pitch[s])) > tol:
            if (i - s) / fps * 1000 >= min_ms and conf[s:i].mean() >= floor:
                out.append(s / fps * 1000)
            s = i
    return np.array(out)


def near(t, marks, ms):
    if len(marks) == 0:
        return np.zeros(len(t), bool)
    j = np.clip(np.searchsorted(marks, t), 1, max(len(marks) - 1, 1))
    return np.minimum(np.abs(t - marks[j - 1]), np.abs(t - marks[np.minimum(j, len(marks) - 1)])) <= ms


def pct(v):
    return rankdata(v, method="average") / len(v)


def flags(r, audio, bpm):
    name = {n: i for i, n in enumerate(r["names"])}
    col = lambda n: r["X"][:, name[n]]
    t = r["t"]
    y, sr = librosa.load(audio, sr=22050, mono=True)
    pitch, conf, fps = contour(y, sr)
    half_beat = 30000 / bpm
    starts = note_starts(pitch, conf, fps, 0.4 * half_beat)
    a = near(t, starts, LEAD_GAP)

    whole = col("flux_full_all") + 1e-9
    b_score = pct(0.5 * pct(col("rel_fluxHmid")) + 0.25 * pct(col("flux_H_mid") / whole) + 0.25 * pct(col("flux_full_mid") / whole))
    b = b_score >= 0.70

    change = np.maximum(pct(col("tv_jump")), pct(col("chroma_change")))
    c = a | (b_score >= 0.85) | ((change >= 0.85) & (b_score >= 0.50))
    print(f"  {len(starts) / (len(y) / sr):.2f} contour notes/s, flagged A {a.mean():.2f} B {b.mean():.2f} C {c.mean():.2f}", flush=True)
    return {"A": a, "B": b, "C": c, "K": np.zeros(len(t), bool)}


def beats_in(beats, a, b):
    return int(np.searchsorted(beats, b) - np.searchsorted(beats, a))


def moments_of(notes):
    return sorted({n["t"] if isinstance(n, dict) else n[0] for n in notes})


def build(model, cfg):
    sid = cfg["id"]
    if sid:
        r = pickle.load(open(f"/scripts/feat/{sid}.pkl", "rb"))
        feat = json.load(open(f"{DATA}/features/{sid}.json"))
        audio = f"{DATA}/audio/{sid}.mp3"
        human_path = f"{DATA}/human/normal/{sid}.json"
        human = moments_of(json.load(open(human_path))) if os.path.exists(human_path) else None
        easy =moments_of(json.load(open(f"{DATA}/charts/v26/easy/{sid}.json")))
        v26 = moments_of(json.load(open(f"{DATA}/charts/v26/normal/{sid}.json")))
    else:
        r = pickle.load(open(cfg["pkl"], "rb"))
        feat = json.load(open(f"/repo/.mewbeat-preview/{HD}.json"))["features"]
        audio = cfg["audio"]
        human = None
        easy = moments_of(json.load(open("/repo/.mewbeat-debug/backup-v26/hopes-and-dreams-easy.json"))["notes"])
        v26 = moments_of(json.load(open("/repo/.mewbeat-debug/backup-v26/hopes-and-dreams-normal.json"))["notes"])

    beats = np.array(feat["tempo"]["beats"], float)
    rate = len(human) / len(beats) if human else DEFAULT_RATE
    t = r["t"]
    Xr = rank_cols(r["X"])
    base = model.decision_function(Xr[:, [r["names"].index(n) for n in BASE_FEATURES]])
    name = {n: i for i, n in enumerate(r["names"])}
    on_grid = (r["X"][:, name["m_beat"]] + r["X"][:, name["m_half"]]) > 0
    fl = flags(r, audio, feat["tempo"]["bpm"])
    fill_gap = 30000 / feat["tempo"]["bpm"] * 0.9

    out = {}
    for v in VARIANTS:
        picked = []
        for start, end, *_ in r["phr"]:
            idx = np.where((t >= start) & (t < end))[0]
            budget = round(rate * beats_in(beats, start, end))
            local = select(t[idx].tolist(), base[idx].tolist(), fl[v][idx].tolist(), on_grid[idx].tolist(), budget, fill_gap_ms=fill_gap)
            picked += [int(round(t[idx[i]])) for i in local]
        out[v] = sorted(set(picked))
    out["V26"] = v26

    parts = HD_PARTS if not sid else [(s["startMs"], "") for s in feat["sections"]]
    return {
        "cfg": cfg, "rate": rate, "out": out, "human": human, "easy": easy, "parts": parts, "durationMs": feat["durationMs"],
        "beats": beats, "t": t, "fl": fl,
    }


def overlap(a, b, ms=35):
    a, b = np.array(a, float), np.array(b, float)
    return float(near(a, b, ms).mean()) if len(a) and len(b) else 0.0


def grid_share(ms, beats):
    ms = np.array(ms, float)
    i = np.clip(np.searchsorted(beats, ms, side="right") - 1, 0, len(beats) - 2)
    u = (ms - beats[i]) / (beats[i + 1] - beats[i])
    u = u - np.floor(u)
    d = np.minimum(np.minimum(u, 1 - u), np.abs(u - 0.5))
    return float((d < 0.07).mean())


def report(results):
    L = ["# Próba słuchowa: warianty pierwszego planu", "",
         "Budżet: tyle momentów na beat, ile ma Normal człowieka w tym utworze; gdy takiego nie ma, mediana z `train` (1,485).",
         "Nazwy wariantów są tu jawne, ale kolejność na stronie jest osobno losowana na każdym utworze.",
         "V26 ma własną liczbę momentów, bo to gotowy Normal generatora: budżet obowiązuje tylko A, B, C i K.",
         "Pierwszy przebieg z progiem długości nuty 0,6 półbeatu dał A i K pokrycie 87% na dwóch utworach, ponad granicę 85% z planu, bo za mało nut konturu oddawało resztę budżetu temu samemu rankingowi. Stąd próg 0,4 półbeatu.", ""]
    names = VARIANTS + ["V26"]
    for res in results:
        c = res["cfg"]
        L += [f"## {c['title']}", "", f"Momentów na beat: {res['rate']:.2f}.", ""]
        head = "| wariant | momenty | beat + półbeat |" + (" trafia w człowieka |" if res["human"] else "")
        L += [head, "|---|---|---|" + ("---|" if res["human"] else "")]
        for v in names:
            row = f"| {v} | {len(res['out'][v])} | {grid_share(res['out'][v], res['beats']) * 100:.0f}% |"
            if res["human"]:
                row += f" {overlap(res['out'][v], res['human']) * 100:.0f}% |"
            L.append(row)
        if res["human"]:
            L.append(f"| człowiek | {len(res['human'])} | {grid_share(res['human'], res['beats']) * 100:.0f}% | |")
        L += ["", "Pokrycie par (ile momentów wiersza ma odpowiednik w kolumnie):", "",
              "| |" + "|".join(names) + "|", "|---|" + "---|" * len(names)]
        for a in names:
            L.append(f"| {a} |" + "|".join(f"{overlap(res['out'][a], res['out'][b]) * 100:.0f}%" for b in names) + "|")
        L.append("")
        if not c["id"]:
            L += ["Udział momentów flagowanych w wyborze, na częściach z opisu użytkownika:", "",
                  "| część | A | B | C |", "|---|---|---|---|"]
            t, fl = res["t"], res["fl"]
            for (start, label), (end, _) in zip(HD_PARTS, HD_PARTS[1:]):
                row = [f"| {start // 1000}–{end // 1000} s {label} |"]
                for v in ("A", "B", "C"):
                    m = np.array([x for x in res["out"][v] if start <= x < end], float)
                    ft = t[fl[v]]
                    row.append(f" {near(m, ft, 2).mean() * 100:.0f}% ({len(m)}) |" if len(m) else " – |")
                L.append("".join(row))
            L.append("")
    return "\n".join(L) + "\n"


def main():
    model = fit_base()
    os.makedirs("/out/data/listening", exist_ok=True)
    rng = random.Random(SEED)
    key, index, results = {}, [], []
    for cfg in SONGS:
        print(cfg["song"], flush=True)
        res = build(model, cfg)
        results.append(res)
        order = VARIANTS + ["V26"]
        rng.shuffle(order)
        key[cfg["song"]] = {str(i + 1): v for i, v in enumerate(order)}
        refs = [{"label": "Easy v26", "moments": [{"t": x} for x in res["easy"]]}]
        if res["human"]:
            refs.append({"label": "Normal człowieka", "moments": [{"t": x} for x in res["human"]]})
        doc = {
            "id": cfg["song"], "title": cfg["title"], "audioId": cfg.get("audioId") or cfg["id"], "durationMs": res["durationMs"],
            "parts": [{"startMs": s, "label": l} for s, l in res["parts"]],
            "variants": [{"label": str(i + 1), "moments": [{"t": x} for x in res["out"][v]]} for i, v in enumerate(order)],
            "references": refs,
        }
        json.dump(doc, open(f"/out/data/listening/{cfg['song']}.json", "w"), ensure_ascii=False)
        index.append({"song": cfg["song"], "title": cfg["title"]})
    json.dump(index, open("/out/data/listening/index.json", "w"), ensure_ascii=False)
    json.dump(key, open("/out/listening-key.json", "w"), indent=1)
    open("/listening/REPORT.md", "w", encoding="utf-8").write(report(results))


if __name__ == "__main__":
    main()
