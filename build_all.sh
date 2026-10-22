#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR"

"$DIR/build.sh" -m lfm2.5 -p 2.6b -q q5_k_m --name queen

echo ""
echo "built:"
ls -lh "$ROOT/tui/dist/queen" 2>/dev/null || true
