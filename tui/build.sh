#!/usr/bin/env bash
# Queen: build the single-file Bun executable that carries elthur + a GGUF.
#
#   1. typecheck
#   2. elthur: `zig build` -> outputs/elthur.a (static) + outputs/lib/libelthur.dylib
#   3. stage the thin dylib so Bun embeds it
#   4. `bun build --compile`
#   5. append the GGUF + ELTHBLOB trailer (idempotent) and codesign
#
# Usage: ./build.sh [model.gguf]
#   ELTHUR_DIR     path to the elthur checkout (default ../../elthur)
set -euo pipefail
cd "$(dirname "$0")"

ELTHUR="${ELTHUR_DIR:-../../elthur}"
MODEL="${1:-${QUEEN_MODEL:-$ELTHUR/core/assets/Qwen3.5-2B-Q8_0.gguf}}"
TARGET="bun-darwin-arm64"
OUT="dist/queen"

if [ ! -f "$MODEL" ]; then
  echo "model not found: $MODEL" >&2
  exit 1
fi

# Python helper runs from a local venv; nothing is installed globally.
if [ ! -x .venv/bin/python3 ]; then
  echo "==> create .venv"
  python3 -m venv .venv
fi
PY=".venv/bin/python3"

echo "==> typecheck"
bun run typecheck

# Vendor pin: the bee-cli submodule is pinned by git; bake its SHA into the
# bundle for /status. No network, no generated source file.
BEE_SHA="$(git -C bee-cli rev-parse HEAD)"
echo "==> bee-cli: ${BEE_SHA:0:12}"

if [ -n "${QUEEN_DYLIB:-}" ]; then
  DYLIB="$QUEEN_DYLIB"
  echo "==> dylib: $DYLIB (provided)"
else
  echo "==> elthur: scripts/build.sh"
  ( cd "$ELTHUR" && ./scripts/build.sh )
  DYLIB="$ELTHUR/outputs/lib/libelthur.dylib"
fi

echo "==> stage dylib"
cp "$DYLIB" libelthur.dylib
codesign --force -s - libelthur.dylib

echo "==> bundle"
mkdir -p dist
bun build --compile src/index.tsx --target "$TARGET" --outfile "$OUT" \
  --define "process.env.QUEEN_BEE_SHA=\"$BEE_SHA\""

# Sign the Mach-O before appending: the model lives past the code, so the
# signature stays valid. Re-signing the enlarged file fails codesign's strict
# validation and is unnecessary.
echo "==> sign"
codesign --force -s - "$OUT"

echo "==> append model"
"$PY" scripts/append_model.py "$MODEL" "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
