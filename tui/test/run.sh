#!/usr/bin/env bash
# Run the Queen harness with live, line-buffered progress.
#
#   tui/test/run.sh                       # tiers a,d on the 230M (fast)
#   tui/test/run.sh a,b,d                 # explicit tiers
#   tui/test/run.sh a,b,d models/LFM2.5-2.6B-Q5_K_M.gguf
#   tui/test/run.sh a,b,c,d --live        # include the live CRUD round-trip
#
# Output is tee'd to /tmp/queen-harness.log, so from another terminal:
#   tail -f /tmp/queen-harness.log        # or:  tui/test/monitor.sh
#
# The 2.6B model is slow on CPU; each model-backed case prints a heartbeat every
# 5s and a "route →" line the moment the orchestrator picks an agent.
set -uo pipefail

tiers="a,d"
model="$PWD/models/LFM2.5-230M-Q8_0.gguf"
extra=()

for a in "$@"; do
  case "$a" in
    --live|--tiers=*|--out=*|--model=*) extra+=("$a") ;;
    a|b|c|d|*,*) tiers="$a" ;;
    *.gguf) model="$a" ;;
    *) extra+=("$a") ;;
  esac
done

cd "$(dirname "$0")/.." || exit 1
log="${QUEEN_HARNESS_LOG:-/tmp/queen-harness.log}"
export QUEEN_TEMPERATURE="${QUEEN_TEMPERATURE:-0}"
export ELTHUR_MODEL="$model"

echo "→ harness tiers=$tiers model=$model"
echo "→ log: $log   (watch: tail -f $log)"
bun test/harness.ts --tiers "$tiers" --out /tmp/queen-harness.json ${extra[@]+"${extra[@]}"} 2>&1 | tee "$log"
