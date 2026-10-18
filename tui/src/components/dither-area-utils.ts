export type DitherColor = "green" | "blue" | "purple" | "pink" | "orange" | "red" | "grey";
export type AreaVariant = "gradient" | "dotted" | "hatched" | "solid";

export const DITHER_PALETTE: Record<DitherColor, string> = {
  blue: "#3590f3",
  green: "#28d26e",
  grey: "#8c8c96",
  orange: "#ff9632",
  pink: "#f05abe",
  purple: "#966eff",
  red: "#f04646",
};

export interface DitherCell {
  char: string;
  color?: string;
  bold?: boolean;
}

export interface DitherAreaOptions {
  values: number[];
  labels?: string[];
  width: number;
  height: number;
  variant?: AreaVariant;
  showGrid?: boolean;
  showAxes?: boolean;
  seriesColor: string;
  axisColor: string;
  gridColor: string;
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function ditherChar(density: number, variant: AreaVariant, x: number, y: number): string {
  const threshold = ((BAYER4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16;
  const level = clamp(density * 1.2 - threshold * 0.2, 0, 1);
  if (variant === "solid") return "█";
  if (level <= threshold * 0.68) return " ";
  if (variant === "dotted") return level > 0.82 ? "•" : "·";
  if (variant === "hatched") return (x + y) % 2 === 0 ? "╱" : "╲";
  if (level > 0.88) return "█";
  if (level > 0.68) return "▓";
  if (level > 0.46) return "▒";
  if (level > 0.26) return "░";
  return "·";
}

export function renderDitherArea(opts: DitherAreaOptions): DitherCell[][] {
  const values = opts.values.length > 0 ? opts.values : [0];
  const labels = opts.labels ?? [];
  const variant = opts.variant ?? "gradient";
  const showGrid = opts.showGrid ?? true;
  const showAxes = opts.showAxes ?? true;
  const width = Math.max(6, Math.floor(opts.width));
  const height = Math.max(2, Math.floor(opts.height));
  const max = Math.max(...values, 1);

  const yAxisW = showAxes ? Math.max(3, String(Math.round(max)).length + 1) : 0;
  const hasLabels = showAxes && labels.length > 0;
  const plotH = Math.max(1, height - (hasLabels ? 1 : 0));
  const plotW = Math.max(1, width - yAxisW);

  const plot: DitherCell[][] = Array.from({ length: plotH }, () =>
    Array.from({ length: plotW }, () => ({ char: " " })),
  );

  if (showGrid && plotH > 2) {
    const step = Math.max(1, Math.floor((plotH - 1) / 2));
    for (let r = 0; r < plotH; r += step) {
      for (let x = 0; x < plotW; x += 1) if (r < plotH) plot[r]![x] = { char: "·", color: opts.gridColor };
    }
  }

  const sample = (x: number): number => {
    if (values.length === 1 || plotW === 1) return values[0] ?? 0;
    const pos = (x / (plotW - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, Math.ceil(pos));
    const t = pos - lo;
    return (values[lo] ?? 0) + ((values[hi] ?? 0) - (values[lo] ?? 0)) * t;
  };

  for (let x = 0; x < plotW; x += 1) {
    const v = sample(x);
    const top = clamp(plotH - 1 - Math.round((v / max) * (plotH - 1)), 0, plotH - 1);
    const span = Math.max(1, plotH - top);
    for (let y = top; y < plotH; y += 1) {
      const density = 0.92 - ((y - top) / span) * 0.58;
      const ch = ditherChar(density, variant, x, y);
      if (ch !== " ") plot[y]![x] = { char: ch, color: opts.seriesColor };
    }
    plot[top]![x] = { char: "•", color: opts.seriesColor, bold: true };
  }

  const out: DitherCell[][] = [];
  const ticks = new Set([0, Math.floor((plotH - 1) / 2), plotH - 1]);
  for (let r = 0; r < plotH; r += 1) {
    const line: DitherCell[] = [];
    if (showAxes) {
      const value = plotH <= 1 ? max : max * (1 - r / (plotH - 1));
      const text = ticks.has(r) ? String(Math.round(value)) : "";
      for (const ch of `${text.padStart(yAxisW - 1)} `) line.push({ char: ch, color: opts.axisColor });
    }
    line.push(...(plot[r] ?? []));
    out.push(line);
  }

  if (hasLabels) {
    const row: DitherCell[] = [];
    if (showAxes) for (let i = 0; i < yAxisW; i += 1) row.push({ char: " ", color: opts.axisColor });
    const cell = plotW / labels.length;
    const labelCells = new Array<string>(plotW).fill(" ");
    for (let idx = 0; idx < labels.length; idx += 1) {
      const label = labels[idx] ?? "";
      const start = Math.round(idx * cell);
      for (let j = 0; j < label.length; j += 1) {
        const x = start + j;
        if (x >= 0 && x < plotW) labelCells[x] = label[j] ?? " ";
      }
    }
    for (let x = 0; x < plotW; x += 1) row.push({ char: labelCells[x] ?? " ", color: opts.axisColor });
    out.push(row);
  }

  return out;
}

