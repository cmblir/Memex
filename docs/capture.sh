#!/bin/bash
# 대시보드 스크린샷 + GIF 자동 캡처.
# 요구: Chrome (macOS 기본 경로), ffmpeg
# 서버가 http://localhost:8090 에서 실행 중이어야 함.

set -e
cd "$(dirname "$0")"

# Chrome 경로 자동 탐지
if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="chromium"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME="google-chrome"
else
  echo "Chrome not found. Install Chrome or Chromium."
  exit 1
fi

OUT=screenshots
mkdir -p "$OUT"
W=1600
H=1000

echo "Capturing dashboard views..."
for pair in \
  "home:" \
  "ingest:#view=ingest" \
  "graph:#view=graph" \
  "history:#view=history" \
  "provenance:#view=provenance" \
  "query:#view=query"
do
  name="${pair%%:*}"
  hash="${pair#*:}"
  url="http://localhost:8090/${hash}"
  echo "  → $name"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size="${W},${H}" --virtual-time-budget=3000 \
    --screenshot="$OUT/$name.png" "$url" 2>/dev/null
done

echo ""
echo "Building demo.gif..."
TMP=$(mktemp)
cat > "$TMP" << EOF
file '$(pwd)/$OUT/home.png'
duration 2.5
file '$(pwd)/$OUT/ingest.png'
duration 2.5
file '$(pwd)/$OUT/graph.png'
duration 2.5
file '$(pwd)/$OUT/history.png'
duration 2.5
file '$(pwd)/$OUT/provenance.png'
duration 2.5
file '$(pwd)/$OUT/query.png'
duration 2.5
file '$(pwd)/$OUT/home.png'
EOF

ffmpeg -y -f concat -safe 0 -i "$TMP" \
  -vf "scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" \
  demo.gif 2>/dev/null

rm -f "$TMP"

echo ""
echo "Done."
ls -la "$OUT/" demo.gif
