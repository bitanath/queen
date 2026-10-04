#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

"$DIR/build.sh" -m qwen3.5  -p 0.8b -q q6_k --name queen-low
"$DIR/build.sh" -m qwen3.5  -p 4b -q q5_k_m --name queen-high

echo ""
echo "built:"
ls -lh "$DIR/tui/dist"/queen-* 2>/dev/null || true
