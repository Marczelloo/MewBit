#!/usr/bin/env bash
# Runs the Easy stage-2 analysis in order; each script's stdout goes to out/<script>.txt.
# Usage: PY=/path/to/venv/bin/python bash mapping-analysis/levels/easy/run_all.sh
set -euo pipefail
cd "$(dirname "$0")"
PY="${PY:-python3}"
for s in 01_profile 02_slots 03_density_bpm 04_patterns_repetition 05_sections 06_genres 07_algo_vs_human 08_holds_floors 09_fragments 11_chords_kiai; do
  echo "== $s"
  "$PY" -I "$s.py" 2>/dev/null > "out/$s.txt"
done
echo "done: out/"
