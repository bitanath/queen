/* @jsxImportSource @opentui/react */
import { NativeImage } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Spinner } from "./spinner";
import { TailLine } from "./one-line";
import { useTheme } from "../theme/use-theme";

const ART_PX = 160;
const TICK_MS = 100;
const HOVER_FRAMES = 20; // 2s at 100ms
const WING_FRAMES = 5; // 0.5s at 100ms
const BLINK_CYCLE = 15; // blink every 1.5s (twice as frequent)
/** Eyelid closeness per blink frame (half → closed → half). */
const BLINK_SEQUENCE = [0.6, 1, 0.6];

type RGBA = readonly [number, number, number, number];
type FrameKey = `${number}:${number}:${number}`;

const C = {
  body: [255, 202, 49, 255] as RGBA,
  bodyLight: [255, 215, 100, 255] as RGBA,
  bodyHi: [255, 235, 177, 255] as RGBA,
  stripe: [41, 41, 41, 255] as RGBA,
  stripeSoft: [67, 67, 67, 255] as RGBA,
  outline: [41, 41, 41, 255] as RGBA,
  wing: [248, 248, 255, 238] as RGBA,
  wingShade: [240, 240, 240, 228] as RGBA,
  wingLine: [255, 255, 255, 255] as RGBA,
  face: [248, 248, 255, 255] as RGBA,
  pupil: [54, 54, 54, 255] as RGBA,
  pupilSoft: [67, 67, 67, 255] as RGBA,
  glint: [255, 255, 255, 255] as RGBA,
  antennaEdge: [122, 122, 122, 255] as RGBA,
  antenna: [45, 45, 45, 255] as RGBA,
  antennaHi: [186, 186, 186, 255] as RGBA,
};

// MARK: - tiny software rasterizer for no reason hehe

function blend(data: Uint8Array, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= ART_PX || y >= ART_PX) return;
  const i = (y * ART_PX + x) * 4;
  const sa = color[3] / 255;
  if (sa <= 0) return;
  const da = (data[i + 3] ?? 0) / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  data[i] = Math.round((color[0] * sa + (data[i] ?? 0) * da * (1 - sa)) / outA);
  data[i + 1] = Math.round((color[1] * sa + (data[i + 1] ?? 0) * da * (1 - sa)) / outA);
  data[i + 2] = Math.round((color[2] * sa + (data[i + 2] ?? 0) * da * (1 - sa)) / outA);
  data[i + 3] = Math.round(outA * 255);
}

function withAlpha(color: RGBA, alpha: number): RGBA {
  return [color[0], color[1], color[2], Math.round(color[3] * alpha)];
}

function ellipse(
  data: Uint8Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  color: RGBA,
): void {
  if (rx <= 0 || ry <= 0) return;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const reach = Math.ceil(Math.max(rx, ry)) + 2;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(ART_PX - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(ART_PX - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const d = (u * u) / (rx * rx) + (v * v) / (ry * ry);
      if (d > 1.06) continue;
      const coverage = Math.min(1, Math.max(0, (1.06 - d) * 9));
      blend(data, x, y, withAlpha(color, coverage));
    }
  }
}

function circle(data: Uint8Array, cx: number, cy: number, radius: number, color: RGBA): void {
  ellipse(data, cx, cy, radius, radius, 0, color);
}

function curve(
  data: Uint8Array,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  width: number,
  color: RGBA,
): void {
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    circle(data, x, y, width, color);
  }
}

/** Quadratic bezier stroked with a brush that tapers from startWidth to endWidth. */
function taperedCurve(
  data: Uint8Array,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  startWidth: number,
  endWidth: number,
  color: RGBA,
): void {
  const steps = 64;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    circle(data, x, y, startWidth + (endWidth - startWidth) * t, color);
  }
}

function triangle(
  data: Uint8Array,
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  color: RGBA,
): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])) - 1);
  const maxX = Math.min(ART_PX - 1, Math.ceil(Math.max(a[0], b[0], c[0])) + 1);
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])) - 1);
  const maxY = Math.min(ART_PX - 1, Math.ceil(Math.max(a[1], b[1], c[1])) + 1);
  const edge = (p: readonly [number, number], q: readonly [number, number], x: number, y: number) =>
    (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const e0 = edge(a, b, px, py);
      const e1 = edge(b, c, px, py);
      const e2 = edge(c, a, px, py);
      if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))) continue;
      blend(data, x, y, color);
    }
  }
}

// MARK: - the actual mfing bee not as ASCII art but as chonky ANSI

function drawAntenna(
  data: Uint8Array,
  cx: number,
  cy: number,
  side: -1 | 1,
  sway: number,
): void {
  const base: readonly [number, number] = [cx + side * 12, cy - 31];
  const joint: readonly [number, number] = [cx + side * 20 + sway * 0.6, cy - 43];
  const tip: readonly [number, number] = [cx + side * 28 + sway, cy - 58];
  const bend: readonly [number, number] = [cx + side * 15, cy - 38];
  const mid: readonly [number, number] = [cx + side * 24, cy - 51];

  taperedCurve(data, base, bend, joint, 5.4, 3.6, C.antennaEdge);
  taperedCurve(data, joint, mid, tip, 3.6, 2.4, C.antennaEdge);
  taperedCurve(data, base, bend, joint, 3.4, 1.9, C.antenna);
  taperedCurve(data, joint, mid, tip, 1.9, 1.0, C.antenna);

  circle(data, base[0], base[1], 3.1, C.antenna);
  circle(data, base[0] - 0.7 * side, base[1] - 0.8, 1.5, C.antennaHi);
  circle(data, joint[0], joint[1], 2.7, C.antenna);
  circle(data, joint[0] - 0.6 * side, joint[1] - 0.7, 1.2, C.antennaHi);

  circle(data, tip[0], tip[1], 4.7, C.antennaEdge);
  circle(data, tip[0], tip[1], 3.4, C.antenna);
  circle(data, tip[0] - 0.9 * side, tip[1] - 1.1, 1.6, C.antennaHi);

  // Two fine setae off the tip for extra detail.
  curve(data, tip, [tip[0] + side * 5, tip[1] - 3], [tip[0] + side * 8, tip[1] - 6.5], 0.9, C.antennaEdge);
  curve(data, joint, [joint[0] + side * 4, joint[1] - 4], [joint[0] + side * 7, joint[1] - 7], 0.8, C.antennaEdge);
}

export function renderBeeFrame(hoverPhase: number, wingPhase: number, blink: number): Uint8Array {
  const data = new Uint8Array(ART_PX * ART_PX * 4);

  const lift = (1 - Math.cos(hoverPhase)) * 4;
  const flap = 1 - 0.17 * (0.5 + 0.5 * Math.sin(wingPhase));
  const littleFlap = 1 - 0.1 * (0.5 + 0.5 * Math.sin(wingPhase + Math.PI / 2));
  const cx = 80;
  const cy = 78 - lift;

  ellipse(data, cx - 40, cy - 8, 31 * flap, 24 * flap, -0.35, C.wing);
  ellipse(data, cx + 40, cy - 8, 31 * flap, 24 * flap, 0.35, C.wing);
  ellipse(data, cx - 37, cy - 11, 16 * flap, 13 * flap, -0.35, C.wingLine);
  ellipse(data, cx + 37, cy - 11, 16 * flap, 13 * flap, 0.35, C.wingLine);
  ellipse(data, cx - 25, cy + 8, 20 * littleFlap, 12 * littleFlap, -0.62, C.wingShade);
  ellipse(data, cx + 25, cy + 8, 20 * littleFlap, 12 * littleFlap, 0.62, C.wingShade);
  ellipse(data, cx - 28, cy + 6, 9 * littleFlap, 5 * littleFlap, -0.62, C.wingLine);
  ellipse(data, cx + 28, cy + 6, 9 * littleFlap, 5 * littleFlap, 0.62, C.wingLine);

  // Stinger (drawn before the body so its top edge tucks underneath).
  triangle(data, [cx - 8, cy + 30], [cx + 8, cy + 30], [cx, cy + 48], C.stripeSoft);
  triangle(data, [cx - 4, cy + 31], [cx + 4, cy + 31], [cx, cy + 43], C.stripe);

  // Body: outline, fill, top-left sheen, then three clipped stripes.
  const R = 36;
  circle(data, cx, cy, R, C.outline);
  circle(data, cx, cy, R - 1.4, C.body);
  ellipse(data, cx - 10, cy - 12, 22, 16, -0.25, withAlpha(C.bodyLight, 0.9));
  ellipse(data, cx - 13, cy - 17, 13, 9, -0.25, withAlpha(C.bodyHi, 0.95));
  for (const [dy, ry] of [
    [15, 4.2],
    [26, 4.2],
    [34, 2.8],
  ] as const) {
    const bandRx = Math.sqrt(Math.max(0, R * R - dy * dy)) - 1.6;
    ellipse(data, cx, cy + dy, bandRx, ry, 0, C.stripe);
  }

  //TODO Face. The eyelid closes by shrinking the eye and fading the pupil.
  const eyeY = cy - 12;
  const lid = Math.min(1, Math.max(0, blink));
  const open = 1 - lid;
  const eyeRy = 2.2 + 9.3 * open;
  ellipse(data, cx - 12, eyeY, 9.5, eyeRy, 0, C.face);
  ellipse(data, cx + 12, eyeY, 9.5, eyeRy, 0, C.face);
  const pupilAlpha = Math.max(0, open * 1.15 - 0.15);
  if (pupilAlpha > 0.05) {
    circle(data, cx - 10, eyeY + 1 * open, 5.7 * (0.55 + 0.45 * open), withAlpha(C.pupil, pupilAlpha));
    circle(data, cx + 10, eyeY + 1 * open, 5.7 * (0.55 + 0.45 * open), withAlpha(C.pupil, pupilAlpha));
    circle(data, cx - 10, eyeY + 1 * open, 3.5 * (0.55 + 0.45 * open), withAlpha(C.pupilSoft, pupilAlpha));
    circle(data, cx + 10, eyeY + 1 * open, 3.5 * (0.55 + 0.45 * open), withAlpha(C.pupilSoft, pupilAlpha));
    circle(data, cx - 8, eyeY - 1.5, 1.9 * open, withAlpha(C.glint, pupilAlpha));
    circle(data, cx + 12, eyeY - 1.5, 1.9 * open, withAlpha(C.glint, pupilAlpha));
  }
  if (lid > 0.55) {
    ellipse(data, cx - 12, eyeY, 9.7, 1.5, 0, C.pupil);
    ellipse(data, cx + 12, eyeY, 9.7, 1.5, 0, C.pupil);
  }

  curve(data, [cx - 9, cy + 3], [cx, cy + 10], [cx + 9, cy + 3], 2.1, C.pupil);
  ellipse(data, cx - 21, cy + 4, 5, 3, -0.15, withAlpha(C.bodyHi, 0.55));
  ellipse(data, cx + 21, cy + 4, 5, 3, 0.15, withAlpha(C.bodyHi, 0.55));

  //HACK Antennae in front of the body so they stay visible against the splash
  const sway = Math.sin(hoverPhase * 2) * 1.6;
  drawAntenna(data, cx, cy, -1, -sway);
  drawAntenna(data, cx, cy, 1, sway);

  return data;
}

// MARK: - component

export type BeeSplashProps = {
  words?: string;
  title?: string;
  hint?: string; //TODO second line under words
  artWidth?: number;
  onCancel?: () => void;
};

export function BeeSplash({
  words = "thinking…",
  title = "queen",
  hint,
  artWidth,
  onCancel,
}: BeeSplashProps) {
  const theme = useTheme();
  const { width, height } = useTerminalDimensions();
  const cache = useRef(new Map<FrameKey, NativeImage>());

  useKeyboard((key) => {
    if (onCancel && key.name === "escape") {
      key.preventDefault();
      onCancel();
    }
  });

  const tick = useTick(TICK_MS);
  const hoverFrame = tick % HOVER_FRAMES;
  const wingFrame = tick % WING_FRAMES;
  const blinkFrame = tick % BLINK_CYCLE;
  const blink = BLINK_SEQUENCE[blinkFrame] ?? 0;

  const frame = useMemo(() => {
    const key: FrameKey = `${hoverFrame}:${wingFrame}:${blink}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    const pixels = renderBeeFrame(
      (hoverFrame / HOVER_FRAMES) * Math.PI * 2,
      (wingFrame / WING_FRAMES) * Math.PI * 2,
      blink,
    );
    const image = NativeImage.fromRgba(pixels, ART_PX, ART_PX);
    cache.current.set(key, image);
    return image;
  }, [blink, hoverFrame, wingFrame]);

  useEffect(() => {
    const images = cache.current;
    return () => {
      for (const image of images.values()) image.dispose();
      images.clear();
    };
  }, []);

  //TODO try fitting the bee to the terminal
  const byWidth = Math.floor(width * 0.34);
  const byHeight = Math.max(12, (height - 8) * 2);
  const artCols = artWidth ?? Math.max(12, Math.min(46, byWidth, byHeight, width - 6));
  const artRows = Math.max(8, Math.round(artCols / 2));
  const lineWidth = Math.max(12, Math.min(width - 8, 72));

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <image source={frame} width={artCols} height={artRows} fit="fill" />

      <box flexDirection="column" alignItems="center" marginTop={1} gap={0}>
        <text fg={theme.colors.primary}>
          <b>{title}</b>
        </text>
        <box flexDirection="row" alignItems="center" gap={1}>
          <Spinner type="dots" color={theme.colors.primary} />
          <TailLine text={words} width={lineWidth} fg={theme.colors.foreground} />
        </box>
        {hint && <text fg={theme.colors.mutedForeground}>{hint}</text>}
      </box>
      {height < artRows + 8 ? null : <box height={1} />}
    </box>
  );
}

/** A tiny interval hook so the bee keeps ticking while the engine is busy. */
function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => (n + 1) % 10_000), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}
