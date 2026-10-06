#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

"$DIR/build.sh" -m qwen3.5 -p 4b -q q5_k_m --name queen
"$DIR/build.sh" --no-model --name queen-lite

echo ""
echo "built:"
ls -lh "$DIR/tui/dist/queen" "$DIR/tui/dist/queen-lite" 2>/dev/null || true
