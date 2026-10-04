// Minimal dither rasteriser for the dashboard sparkline. Reduced from termcn's
// `opentui/dither-sparkline` to a single non-interactive area chart: no axes,
// grid, tooltip, bloom, animation or keyboard handling.

export type DitherColor = "green" | "blue" | "purple" | "pink" | "orange" | "red" | "grey";
export type DitherVariant = "gradient" | "dotted" | "hatched" | "solid";

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
}

export interface SparklineRenderOptions {
  width: number;
  height: number;
  variant?: DitherVariant;
  /** Data index to mark with an active dot (defaults to none). */
  markerIndex?: number;
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function ditherChar(density: number, variant: DitherVariant, x: number, y: number): string {
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

/**
 * Rasterise `data` into a `height`×`width` grid. Each column samples the series
 * (linearly interpolated) and fills downward with Bayer-dithered density, so
 * taller columns read as higher values; the sampled peak gets a marker glyph.
 */
export function renderSparkline(data: number[], opts: SparklineRenderOptions): DitherCell[][] {
  const width = Math.max(1, Math.floor(opts.width));
  const height = Math.max(1, Math.floor(opts.height));
  const variant = opts.variant ?? "gradient";
  const frame: DitherCell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ char: " " })),
  );
  if (data.length === 0) return frame;

  const max = Math.max(...data, 1);
  const sample = (x: number): number => {
    if (data.length === 1 || width === 1) return data[0] ?? 0;
    const pos = (x / (width - 1)) * (data.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(data.length - 1, Math.ceil(pos));
    const t = pos - lo;
    const a = data[lo] ?? 0;
    const b = data[hi] ?? a;
    return a + (b - a) * t;
  };

  const markerCol =
    opts.markerIndex === undefined || data.length <= 1
      ? -1
      : Math.round((clamp(opts.markerIndex, 0, data.length - 1) / (data.length - 1)) * (width - 1));

  for (let x = 0; x < width; x += 1) {
    const value = sample(x);
    const top = height - 1 - Math.round((value / max) * (height - 1));
    const span = Math.max(1, height - top);
    for (let y = top; y < height; y += 1) {
      const density = 0.92 - ((y - top) / span) * 0.58;
      const char = ditherChar(density, variant, x, y);
      if (char !== " ") frame[y]![x] = { char };
    }
    frame[top]![x] = { char: x === markerCol ? "◉" : "•" };
  }
  return frame;
}
