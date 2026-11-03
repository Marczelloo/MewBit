"""Stage 3: on which level is the generator closest to human mapping? (checks the user's "Hard is better than Normal")

    python3 -I synthesis/level_distance.py [--shared shared] [--out synthesis/out]

The panel of metrics was fixed before computing: density, grid coverage, gap classes, chords, holds, jacks, trills,
rests, section boundaries, kiai, repetition, notes on onsets, off-grid notes. For each level and test song the
generator's value is compared with the human chart of the same song: |algo - human| divided by the human
inter-quartile range of that metric on that level (all human charts of the level), so "1" means one human IQR away and
levels with different spreads stay comparable. Reported per metric: the median over songs, the share of songs where the
generator falls inside the human p10-p90 band of the level, and the paired difference. Plus the generator's precision
and recall against the human chart of the same level (versus_human).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ("easy", "normal", "hard")
PANEL = [
    ("notes_per_beat", "gęstość (nuty/beat)"),
    ("coverage.beat", "beaty z nutą"),
    ("coverage.half", "półbeaty z nutą"),
    ("gap_share.1/2", "odstępy 1/2"),
    ("gap_share.1", "odstępy 1/1"),
    ("chord_share", "akordy"),
    ("hold_share", "holdy"),
    ("holds_context.release_at_next_moment_share", "puszczenie holda na następnej nucie"),
    ("holds_with_notes_inside_share", "holdy z nutą w środku"),
    ("minijack_share", "minijacki"),
    ("trill_share", "tryle"),
    ("rests_ge_2b.per_min", "pauzy ≥ 2 beaty/min"),
    ("sections.boundary_note_share", "nuta na granicy sekcji"),
    ("kiai_density_ratio", "gęstość kiai / reszta"),
    ("repetition_lift", "rytm: powtórzenie − baza"),
    ("alignment.perc.share", "nuty na onsecie perk."),
    ("alignment.no_sound_share", "nuty bez dźwięku"),
    ("offgrid_share", "nuty poza siatką (1/16, off)"),
]


def load(shared: Path, level: str, who: str) -> pd.DataFrame:
    df = pd.read_csv(shared / "data" / level / f"{who}_metrics.csv")
    df["repetition_lift"] = df["repetition.repeat.rhythm"] - df["repetition.baseline.rhythm"]
    df["offgrid_share"] = df["snap_share.16"].fillna(0) + df["snap_share.off"].fillna(0)
    return df.set_index("set_id")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared", type=Path, default=ROOT / "shared")
    ap.add_argument("--out", type=Path, default=ROOT / "synthesis" / "out")
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    rows, summary = [], {}
    for level in LEVELS:
        human, algo = load(args.shared, level, "human"), load(args.shared, level, "algo")
        both = algo.index.intersection(human.index)
        dists, inside = [], []
        for col, label in PANEL:
            h_all = human[col].dropna()
            iqr = float(h_all.quantile(0.75) - h_all.quantile(0.25)) or float(h_all.std()) or 1.0
            lo, hi = float(h_all.quantile(0.1)), float(h_all.quantile(0.9))
            a, h = algo.loc[both, col], human.loc[both, col]
            ok = a.notna() & h.notna()
            d = ((a[ok] - h[ok]).abs() / iqr)
            within = ((a[ok] >= lo) & (a[ok] <= hi)).mean() if ok.any() else np.nan
            rows.append({"level": level, "metric": col, "label": label, "n": int(ok.sum()),
                         "human_p50": float(h[ok].median()) if ok.any() else None, "algo_p50": float(a[ok].median()) if ok.any() else None,
                         "paired_diff_p50": float((a[ok] - h[ok]).median()) if ok.any() else None,
                         "distance_iqr_p50": float(d.median()) if ok.any() else None, "algo_inside_human_p10_p90": float(within)})
            dists.append(float(d.median()) if ok.any() else np.nan)
            inside.append(within)
        vs = algo.loc[both]
        summary[level] = {
            "songs": int(len(both)),
            "median_distance_iqr": float(np.nanmedian(dists)),
            "mean_distance_iqr": float(np.nanmean(dists)),
            "metrics_with_median_inside_band": int(sum(1 for r in rows if r["level"] == level and r["algo_p50"] is not None
                                                       and human[r["metric"]].quantile(0.1) <= r["algo_p50"] <= human[r["metric"]].quantile(0.9))),
            "share_inside_band_mean": float(np.nanmean(inside)),
            "precision_p50": float(vs["versus_human.precision"].median()), "recall_p50": float(vs["versus_human.recall"].median()),
            "precision_p10_p90": [float(vs["versus_human.precision"].quantile(0.1)), float(vs["versus_human.precision"].quantile(0.9))],
            "recall_p10_p90": [float(vs["versus_human.recall"].quantile(0.1)), float(vs["versus_human.recall"].quantile(0.9))],
        }
    table = pd.DataFrame(rows)
    table.to_csv(args.out / "level_distance.csv", index=False)
    (args.out / "level_distance_summary.json").write_text(json.dumps(summary, indent=1))
    pivot = table.pivot(index="label", columns="level", values="distance_iqr_p50")[list(LEVELS)].reindex([p[1] for p in PANEL])
    print("distance from humans, in human IQRs (median over test songs):")
    print(pivot.round(2).to_string())
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
