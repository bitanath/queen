#!/usr/bin/env bash
# Follow the harness log (line-buffered progress from tui/test/run.sh).
#   tui/test/monitor.sh                 # /tmp/queen-harness.log
#   tui/test/monitor.sh /tmp/other.log
log="${1:-${QUEEN_HARNESS_LOG:-/tmp/queen-harness.log}}"
[ -f "$log" ] || { echo "no log yet at $log — start it with tui/test/run.sh"; exit 1; }
exec tail -n +1 -f "$log"
