// View model for the factor-analysis panel shown at the bottom of the centre
// pane. The analysis is always conversation-sourced; for fact/insight docs the
// doc's topic is forced into the dims and the factor that best explains it is
// selected (and renamed to the topic). The view carries the loadings table, a
// per-factor variance bar chart, a plain-English summary and a glossary footer.
import { dimDisplay, dimGlossary, dimIsTopic, dimNoun } from "./factors";
import type { AnalyticsResult } from "./pipeline";
import type { TopicKey } from "./types";

export type FactorBar = { label: string; value: number; highlight: boolean };
export type FactorGlossary = { label: string; text: string };

export type FactorMatrixView = {
  title: string;
  summary: string;
  rowLabels: string[];
  colLabels: string[];
  data: number[][];
  /** Index of the emphasised column (-1 for none). */
  highlightCol: number;
  bars: FactorBar[];
  glossary: FactorGlossary[];
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Driver nouns for the prose summary: strongest positive dims on the factor. */
function drivers(dims: string[], values: number[][], factor: number): { nouns: string[]; anyTopic: boolean } {
  const positive = dims
    .map((dim, i) => ({ dim, v: values[i]?.[factor] ?? 0 }))
    .filter((l) => l.v >= 0.3)
    .sort((a, b) => b.v - a.v)
    .slice(0, 2);
  const picked = positive.length > 0
    ? positive
    : dims
        .map((dim, i) => ({ dim, v: values[i]?.[factor] ?? 0 }))
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .slice(0, 2);
  return {
    nouns: picked.map((l) => dimNoun(l.dim)),
    anyTopic: picked.some((l) => dimIsTopic(l.dim)),
  };
}

export function factorMatrix(
  result: AnalyticsResult,
  opts: { topic?: TopicKey | null; emoji?: string; label?: string } = {},
): FactorMatrixView {
  const { dims, factors, values } = result.loadings;
  const names = result.factorNames;
  const variance = result.variance ?? [];

  // Pick the factor that best explains the doc's topic (typed docs only).
  let selected = 0;
  let typed = false;
  if (opts.topic) {
    const di = dims.indexOf(`${opts.topic}_rate`);
    if (di >= 0) {
      typed = true;
      let bestV = -1;
      factors.forEach((_, f) => {
        const v = Math.abs(values[di]?.[f] ?? 0);
        if (v > bestV) {
          bestV = v;
          selected = f;
        }
      });
    }
  }

  const topicLabel = opts.topic
    ? `${opts.emoji ?? ""} ${opts.label ?? cap(opts.topic)}`.trim()
    : "";
  const colLabels = factors.map((f, i) =>
    i === selected && typed ? topicLabel : names[i]?.short ?? f,
  );

  // Order rows by relevance to the selected factor.
  const order = dims
    .map((_, i) => i)
    .sort((a, b) => Math.abs(values[b]?.[selected] ?? 0) - Math.abs(values[a]?.[selected] ?? 0));

  const k = factors.length;
  const title = typed
    ? `Factor Analysis · top ${k} factors fitted to ${topicLabel}`
    : `Factor Analysis · top ${k} factors driven by conversation`;

  const { nouns, anyTopic } = drivers(dims, values, selected);
  const driverText = nouns.length > 0 ? `driven by ${nouns.join(" and ")}${anyTopic ? " keywords" : ""} in conversation` : "";
  const summary = typed
    ? `${topicLabel} is the factor here${driverText ? `, ${driverText}` : ""}.`
    : `${cap(names[selected]?.short ?? `F${selected + 1}`)} was the strongest factor here${driverText ? `, ${driverText}` : ""}.`;

  // Footer: explain only the non-obvious metrics that load *high positive* on
  // the selected factor (negative loadings are a separate story).
  const glossary: FactorGlossary[] = [];
  const strong = dims
    .map((dim, i) => ({ dim, v: values[i]?.[selected] ?? 0 }))
    .filter((l) => l.v >= 0.4)
    .sort((a, b) => b.v - a.v);
  for (const { dim } of strong) {
    const text = dimGlossary(dim);
    if (!text) continue;
    glossary.push({ label: dimDisplay(dim), text });
    if (glossary.length >= 6) break;
  }

  const bars: FactorBar[] = factors.map((_, i) => ({
    label: colLabels[i] ?? `F${i + 1}`,
    value: Math.round((variance[i] ?? 0) * 100),
    highlight: typed && i === selected,
  }));

  return {
    title,
    summary,
    rowLabels: order.map((i) => dimDisplay(dims[i] ?? "")),
    colLabels,
    data: order.map((i) => values[i] ?? []),
    highlightCol: typed ? selected : -1,
    bars,
    glossary,
  };
}
