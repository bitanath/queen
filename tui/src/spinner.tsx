import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Small indeterminate spinner + label. Ticks on an interval, so it animates
/// whenever the main thread is free (Bee fetch, GGUF streaming polls).
export function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return <text attributes={TextAttributes.DIM}>{`${FRAMES[i] ?? "⠋"} ${label}`}</text>;
}
