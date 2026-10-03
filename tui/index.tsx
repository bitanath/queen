import "./src/utils/preload";
import { render } from "./src/app";
import { runSmoke, smokeRequested } from "./src/utils/smoke-test";

// One entry, three modes. QUEEN_WARM execs and exits: macOS validates the whole
// signed file at exec, before any JS here runs, so this run primes its cache and
// makes the next launch fast (the build uses it). QUEEN_SMOKE runs the headless
// suite, otherwise the TUI.
if (process.env.QUEEN_WARM) {
  // no-op: the exec itself is the warm-up.
} else if (smokeRequested()) {
  void runSmoke();
} else {
  render();
}
