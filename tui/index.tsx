import "./src/utils/preload-env-variables";
import { render } from "./src/app";
import { runSmoke, smokeRequested } from "./src/utils/smoke-test";

if (process.env.QUEEN_WARM) {
  // no-op: the exec itself is the warm-up.
} else if (smokeRequested()) {
  void runSmoke();
} else {
  render();
}
