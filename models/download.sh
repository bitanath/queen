#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${QUEEN_MODELS_DIR:-$(cd "$(dirname "$0")" && pwd)}"
FILE="${1:-LFM2.5-2.6B-Q5_K_M.gguf}"
URL="https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/$FILE"
DEST="$MODELS_DIR/$FILE"

if [ -s "$DEST" ]; then
  echo "model present: $DEST"
  exit 0
fi

mkdir -p "$MODELS_DIR"
AUTH=()
[ -n "${HF_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $HF_TOKEN")

echo "downloading: $URL"
curl -fL --retry 3 --retry-delay 2 -C - "${AUTH[@]}" -o "$DEST.part" "$URL"
mv "$DEST.part" "$DEST"
echo "saved: $DEST"
