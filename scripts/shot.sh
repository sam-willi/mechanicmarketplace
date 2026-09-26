#!/bin/sh
# usage: scripts/shot.sh <url-path> <out.png> <width> [height]
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W=${3:-1440}; H=${4:-2400}
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=$W,$H --virtual-time-budget=4000 --screenshot="$2" "http://localhost:3100$1" >/dev/null 2>&1
