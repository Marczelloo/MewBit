# Long holds on a sound against an exact placebo (the same length laid on every tap), pooled and per song (mean on-rate over mean placebo rate), and Hopes and Dreams 0-112 s with a lenient rule (measure.py) and a strict one (head within 80 ms of the sound, end within half a beat of it).
# In mewbeat-ma, like measure.py: python3 exact_placebo.py <chart label> ...  (human is always included)
import sys, json
sys.path.insert(0, "/holds"); sys.path.insert(0, "/scripts"); sys.path.insert(0, "/listening")
import numpy as np
import measure as M
labels = sys.argv[1:]
ids = M.train_ids()
def covers(d, L, seg):
    if len(seg) == 0: return np.zeros(len(d), bool)
    ov = np.minimum((d + L)[:, None], (seg[:, 0] + seg[:, 1])[None, :]) - np.maximum(d[:, None], seg[:, 0][None, :])
    return ov.max(axis=1) / L >= M.SOUNDING
res = {}
for lb in ["human"] + labels:
    rows = []; on = n_long = 0; plc_sum = 0.0; ratios = []; holds_total = 0; songs = 0
    for sid in ids:
        r, x, f, lead, bass = M.load_song(sid)
        beat = 60000.0 / r["bpm"]
        seg = np.concatenate([M.stack(x["stems"])[s][M.stack(x["stems"])[s][:, 4] >= M.MIN_SHARE] for s in M.STEMS])
        path = f"/out/data/human/normal/{sid}.json" if lb == "human" else f"/out/data/charts/{lb}/normal/{sid}.json"
        c = M.chart(path, lb == "human")
        if c is None or len(c["t"]) == 0: continue
        held = np.where(~np.isnan(c["end"]))[0]
        taps = c["t"][np.isnan(c["end"])]
        if len(taps) == 0: taps = c["t"]
        so = sp = k = 0; 
        for i in held:
            L = c["end"][i] - c["t"][i]
            if L < M.LONG_BEATS * beat: continue
            k += 1
            so += bool(covers(np.array([c["t"][i]]), L, seg)[0])
            sp += covers(taps, L, seg).mean()
        holds_total += len(held)
        if k == 0: continue
        n_long += k; on += so; plc_sum += sp; songs += 1
        if sp > 0: ratios.append((so / k) / (sp / k)); rows.append((k, so / k, sp / k))
    res[lb] = dict(songs=songs, holds=holds_total, long_holds=n_long, long_on_sound=on, on_rate=round(on / n_long, 3), placebo_rate=round(plc_sum / n_long, 3),
                   ratio_pooled=round((on / n_long) / (plc_sum / n_long), 2), ratio_per_song_mean=round(float(np.mean(ratios)), 2), ratio_per_song_median=round(float(np.median(ratios)), 2))
    print(lb, json.dumps(res[lb]), flush=True)
    ra = np.array(rows)
    print('  macro', round(ra[:,1].mean()/ra[:,2].mean(),2), 'k>=3 per-song mean', round(float(np.mean([a/b for k,a,b in rows if k>=3 and b>0])),2), 'k>=3 macro', round(float(np.mean([a for k,a,b in rows if k>=3])/np.mean([b for k,a,b in rows if k>=3])),2), 'k>=5 macro', round(float(np.mean([a for k,a,b in rows if k>=5])/np.mean([b for k,a,b in rows if k>=5])),2), 'songs on>0 per-song mean', round(float(np.mean([a/b for k,a,b in rows if a>0 and b>0])),2), flush=True)
# H&D 0-112 s
r, x, f, lead, bass = M.load_song("hd")
beat = 60000.0 / r["bpm"]
ls = M.long_sounds(M.stack(x["stems"]), beat)
ls = ls[(ls[:, 0] >= 0) & (ls[:, 0] < 112000)]
print("HD long sounds", len(ls))
for lb in labels:
    c = M.chart(f"/out/data/charts/{lb}-hd/normal.json", False)
    held = np.where(~np.isnan(c["end"]))[0]
    hh, ee = c["t"][held], c["end"][held]
    len_, str_ = 0, 0
    for t, l, _ in ls:
        ov = np.minimum(t + l, ee) - np.maximum(t, hh)
        len_ += int(len(ov) > 0 and ((np.abs(hh - t) <= 80).any() or (ov >= .5 * l).any()))
        str_ += int(len(hh) > 0 and bool(((np.abs(hh - t) <= 80) & (np.abs(ee - (t + l)) <= beat / 2)).any()))
    print("HD", lb, "lenient", len_, "strict", str_, "of", len(ls))
