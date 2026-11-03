"""Quantiles of every Easy metric: humans (train, test) and the generator (test). Writes out/profile_all.csv."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import pandas as pd

from common import OUT, metrics, q

h = metrics("human")
a = metrics("algo")
skip = {"set_id", "year", "beatmap_id", "easy_owners", "song.red_lines"}
num = [c for c in h.columns if c not in skip and pd.api.types.is_numeric_dtype(h[c])]
rows = []
for c in num:
    r = {"metric": c}
    for name, df in [("tr", h[h.split == "train"]), ("te", h[h.split == "test"]), ("al", a)]:
        if c not in df.columns:
            continue
        s = pd.to_numeric(df[c], errors="coerce")
        p10, p50, p90 = q(s)
        r.update({f"{name}_n": int(s.notna().sum()), f"{name}_p10": p10, f"{name}_p50": p50, f"{name}_p90": p90,
                  f"{name}_min": s.min(), f"{name}_max": s.max()})
    rows.append(r)
prof = pd.DataFrame(rows)
prof.to_csv(OUT / "profile_all.csv", index=False, float_format="%.4g")
pd.set_option("display.width", 250)
pd.set_option("display.max_rows", 400)
cols = ["metric", "tr_n", "tr_min", "tr_p10", "tr_p50", "tr_p90", "tr_max", "te_p10", "te_p50", "te_p90", "al_p10", "al_p50", "al_p90"]
print(prof[cols].to_string(index=False, float_format=lambda v: f"{v:.3g}"))
