#!/usr/bin/env bash
# Build all queen variants in one go, each with its own model:
#
#   queen-low    qwen3.5  / 0.8b / q6_k
#   queen-high   qwen3.5  / 4b   / q5_k_m
#
# Thin wrapper: every artifact is built by ./build.sh, so the elthur dylib is
# built/reused once (by the first call) and the model is downloaded if missing.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

"$DIR/build.sh" -m qwen3.5  -p 0.8b -q q6_k --name queen-low
"$DIR/build.sh" -m qwen3.5  -p 4b -q q5_k_m --name queen-high

echo ""
echo "built:"
ls -lh "$DIR/tui/dist"/queen-* 2>/dev/null || true
