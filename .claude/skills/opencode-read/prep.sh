#!/usr/bin/env bash
# After `npm run agent-read -- prepare ...`: give worker B its own file and make viewable image copies.
set -euo pipefail
shopt -s nullglob
cd "${1:-.agent-read}"
for d in */; do
  cp "$d/read.json" "$d/read-b.json"
  for f in "$d"image-*; do
    b=$(basename "${f%.*}")
    if command -v sips >/dev/null; then sips -s format jpeg -Z 2000 "$f" --out "$d/view-$b.jpg" >/dev/null
    else magick "$f" -resize '2000x2000>' "$d/view-$b.jpg"; fi
  done
done
views=(*/view-*.jpg)
echo "$(ls -d */ | wc -l | tr -d ' ') race(s), ${#views[@]} image(s) ready"
