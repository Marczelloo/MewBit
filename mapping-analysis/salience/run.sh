#!/bin/sh
# usage: run.sh <script.py> [args]
cd /c/Users/moskw/Documents/dev/MewBit
SW=C:/Users/moskw/AppData/Local/Temp/claude/C--Users-moskw-Documents-dev-MewBit/e3ff4a14-5ba5-4165-933c-da87b17acb26/scratchpad/ma-run/salience
MSYS_NO_PATHCONV=1 docker run --rm -v mewbeat-ma:/work -v "$(pwd -W):/repo:ro" -v "$SW:/scripts" -w /tmp mewbeat-ma python3 "/scripts/$@"
