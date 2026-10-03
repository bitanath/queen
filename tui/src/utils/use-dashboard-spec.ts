// Holds the active dashboard spec. The dashboard renders from `spec`; anything
// that wants to change what's shown calls `setSpec(normalizeDashboardSpec(...))`.
// For now ctrl+e cycles the demo presets to test the surface; the agent tool
// (when wired) just calls setSpec.
import { useKeyboard } from "@opentui/react";
import { useState } from "react";

import { DEFAULT_DASHBOARD_SPEC, DEMO_SPECS, type DashboardSpec } from "./dashboard-spec";

const NAMES = Object.keys(DEMO_SPECS);

export function useDashboardSpec() {
  const [spec, setSpec] = useState<DashboardSpec>(DEFAULT_DASHBOARD_SPEC);

  const cycle = () => {
    setSpec((cur) => {
      const i = NAMES.findIndex((name) => DEMO_SPECS[name] === cur);
      return DEMO_SPECS[NAMES[(i + 1) % NAMES.length]!] ?? DEFAULT_DASHBOARD_SPEC;
    });
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "e") {
      key.preventDefault();
      cycle();
    }
  });

  return { spec, setSpec, cycle, names: NAMES };
}
