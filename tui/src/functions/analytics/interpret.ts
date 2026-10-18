
import { streamGenerate } from "../../utils/queen-ffi";
import { stripThinking } from "../../utils/stream-status";
import type { Loadings } from "./pipeline";

const SYSTEM =
  "You interpret factor-analysis loadings from a wearable-transcript behaviour study. " +
  "For each factor, reply with exactly one short line: `F1: <reading>` — at most 8 words, " +
  "naming what high values mean. No preamble, no analysis, no extra lines."; //TODO agent interpretation of factor loadings

function topLoadings(loadings: Loadings, factorIndex: number): string {
  return loadings.dims
    .map((name, di) => ({ name, v: loadings.values[di]?.[factorIndex] ?? 0 }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 6)
    .map((t) => `${t.name} ${t.v >= 0 ? "+" : ""}${t.v.toFixed(2)}`)
    .join(" · ");
}

export async function interpretLoadings(loadings: Loadings): Promise<string[] | null> {
  const body = loadings.factors.map((f, i) => `${f}: ${topLoadings(loadings, i)}`).join("\n");
  const res = await streamGenerate({
    prompt: `Loadings (metric value):\n${body}\n\nGive one line per factor.`,
    system: SYSTEM,
    maxTokens: 1024,
    onChunk: () => {},
  });
  const text = stripThinking(res.text);
  const out: string[] = [];
  loadings.factors.forEach((f) => {
    const n = f.replace(/[^0-9]/g, "");
    const m = new RegExp(`(?:factor\\s*)?${n}\\s*[:\\-]\\s*(.+)`, "i").exec(text);
    const read = m?.[1]?.trim().replace(/[.\s]+$/, "");
    if (read) out.push(`${f}: ${read}`);
  });
  return out.length >= Math.min(3, loadings.factors.length) ? out : null;
}
