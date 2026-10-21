#!/usr/bin/env bash
# Run the Queen harness with live, line-buffered progress.
#
#   tui/test/run.sh                       # tiers a,d on the 2.6B
#   tui/test/run.sh a,b,d                 # explicit tiers
#   tui/test/run.sh a,b,d models/LFM2.5-2.6B-Q5_K_M.gguf
#   tui/test/run.sh a,b,c,d,e,i --live    # live Bee CRUD + one-shot CLI + SSE watcher
#   tui/test/run.sh a,m --live            # live macOS automation (Notes/Reminders/Calendar)
#
# Output is tee'd to /tmp/queen-harness.log, so from another terminal:
#   tail -f /tmp/queen-harness.log        # or:  tui/test/monitor.sh
#
# The 2.6B model is slow on CPU; each model-backed case prints a heartbeat every
# 5s and a "route →" line the moment the orchestrator picks an agent.
set -uo pipefail

tiers="a,d"
model=""
extra=()

for a in "$@"; do
  case "$a" in
    --live|--tiers=*|--out=*|--model=*) extra+=("$a") ;;
    a|b|c|d|e|i|m|*,*) tiers="$a" ;;
    *.gguf) model="$a" ;;
    *) extra+=("$a") ;;
  esac
done

case "$model" in
  "") ;;
  /*) ;;
  *) model="$PWD/$model" ;;
esac

cd "$(dirname "$0")/.." || exit 1
model="${model:-$PWD/../models/LFM2.5-2.6B-Q5_K_M.gguf}"
log="${QUEEN_HARNESS_LOG:-/tmp/queen-harness.log}"

if [ ! -s "$model" ]; then
  case ",$tiers," in
    *,b,* | *,d,*)
      echo "model not found: $model" >&2
      echo "pass a .gguf path, set QUEEN_MODEL, or run the model-free tiers (a,m,c,i)" >&2
      exit 2
      ;;
    *)
      echo "→ note: model not found: $model (tiers $tiers do not need it)"
      ;;
  esac
fi

export QUEEN_TEMPERATURE="${QUEEN_TEMPERATURE:-0}"
export ELTHUR_MODEL="$model"

echo "→ harness tiers=$tiers model=$model"
echo "→ log: $log   (watch: tail -f $log)"
bun test/harness.ts --tiers "$tiers" --out /tmp/queen-harness.json ${extra[@]+"${extra[@]}"} 2>&1 | tee "$log"
