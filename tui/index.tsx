import "./src/utils/preload";
import { render } from "./src/app";
import { runSmoke, smokeRequested } from "./src/utils/smoke-test";

// One entry, two modes: QUEEN_SMOKE runs the headless suite, otherwise the TUI.
if (smokeRequested()) {
  void runSmoke();
} else {
  render();
}
