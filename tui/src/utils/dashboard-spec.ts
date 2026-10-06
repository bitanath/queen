import type { AlertVariant } from "../components/alert";
import type { MultiProgressItem, MultiProgressStatus } from "../components/multi-progress";
import type { Column } from "../components/table";
import type { DitherColor, DitherVariant } from "../components/sparkline-utils";
import { modelParams } from "../functions/model-params";

export type Align = "left" | "right" | "center";

export type BarItem = { label: string; value: number; color?: string };

export type LinePoint = number | { label?: string; value: number };

export type ChartSpec =
  | { type: "bar"; title: string; data: BarItem[] }
  | {
      type: "sparkline";
      title: string;
      data: number[];
      label?: string;
      color?: DitherColor;
      variant?: DitherVariant;
      markerIndex?: number;
    }
  | { type: "gauge"; title: string; value: number; label?: string; min?: number; max?: number }
  | { type: "line"; title: string; data: LinePoint[] }
  | { type: "pie"; title: string; data: BarItem[] }
  | { type: "heatmap"; title: string; data: number[][]; rowLabels?: string[] };

export type StatItem = { key: string; value: string };

export type TableSpec = {
  title: string;
  columns: string[];
  aligns?: Align[];
  rows: (string | number)[][];
  stats?: StatItem[];
};

export type AlertSpec = {
  variant: AlertVariant;
  title: string;
  message: string;
  appendix: string;
};

/** Pre-turn alert: point logged-out users at /login; otherwise the default copy. */
export function initialAlert(base: AlertSpec, loggedIn: boolean | null): AlertSpec {
  if (loggedIn !== false) return base;
  return { ...base, title: "Not Logged In", message: "Type /login to access your Bee Data" };
}

export type ContextSpec = {
  items: MultiProgressItem[];
};

// TODO: wire this spec into the agent (render_dashboard) so chat can mutate the dashboard.
export type DashboardSpec = {
  charts: ChartSpec[];
  /** Left-hand panel: per-session detail rows (dummy data for now). */
  details: TableSpec;
  table: TableSpec;
  context: ContextSpec;
  alert: AlertSpec;
};

export type Row = Record<string, unknown>;

const CHART_TYPES = new Set(["bar", "sparkline", "gauge", "line", "pie", "heatmap"]);
const ALIGNS = new Set<Align>(["left", "right", "center"]);
const ALERT_VARIANTS = new Set<AlertVariant>(["success", "error", "warning", "info"]);
const PROGRESS_STATUS = new Set<MultiProgressStatus>(["pending", "running", "done", "error"]);
const DITHER_COLORS = new Set<DitherColor>(["green", "blue", "purple", "pink", "orange", "red", "grey"]);
const DITHER_VARIANTS = new Set<DitherVariant>(["gradient", "dotted", "hatched", "solid"]);

// MARK: - helpers for all kinds of logic

export function tableColumns(spec: TableSpec): Column<Row>[] {
  return spec.columns.map((header, i) => ({
    key: header,
    header,
    align: spec.aligns?.[i] ?? "left",
  }));
}

export function tableRows(spec: TableSpec): Row[] {
  return spec.rows.map((cells) =>
    Object.fromEntries(spec.columns.map((header, i) => [header, cells[i] ?? ""])),
  );
}

function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}



function normalizeChart(panel: unknown): ChartSpec | null {
  //TODO returns chart to fit the interface panel according to the parsed panel.type
  if (!isObject(panel)) return null;
  const type = toStr(panel.type);
  if (!CHART_TYPES.has(type)) return null;
  const title = toStr(panel.title) || type;

  if (type === "bar") {
    const data: BarItem[] = (Array.isArray(panel.data) ? panel.data : [])
      .map((d): BarItem | null => {
        if (!isObject(d)) return null;
        const value = toNum(d.value);
        if (value === null) return null;
        const item: BarItem = { label: toStr(d.label), value };
        if (typeof d.color === "string") item.color = d.color;
        return item;
      })
      .filter((d): d is BarItem => d !== null);
    return { type: "bar", title, data };
  }
  else if (type === "sparkline") {
    const data = (Array.isArray(panel.data) ? panel.data : [])
      .map(toNum)
      .filter((n): n is number => n !== null);
    const spec: Extract<ChartSpec, { type: "sparkline" }> = { type: "sparkline", title, data };
    if (typeof panel.label === "string") spec.label = panel.label;
    if (typeof panel.color === "string" && DITHER_COLORS.has(panel.color as DitherColor)) {
      spec.color = panel.color as DitherColor;
    }
    if (typeof panel.variant === "string" && DITHER_VARIANTS.has(panel.variant as DitherVariant)) {
      spec.variant = panel.variant as DitherVariant;
    }
    const marker = toNum(panel.markerIndex);
    if (marker !== null) spec.markerIndex = marker;
    return spec;
  }
  else if (type === "pie") {
    const data: BarItem[] = (Array.isArray(panel.data) ? panel.data : [])
      .map((d): BarItem | null => {
        if (!isObject(d)) return null;
        const value = toNum(d.value);
        if (value === null) return null;
        const item: BarItem = { label: toStr(d.label), value };
        if (typeof d.color === "string") item.color = d.color;
        return item;
      })
      .filter((d): d is BarItem => d !== null);
    return { type: "pie", title, data };
  }
  else if (type === "line") {
    const data: LinePoint[] = (Array.isArray(panel.data) ? panel.data : [])
      .map((d): LinePoint | null => {
        if (typeof d === "number") return Number.isFinite(d) ? d : null;
        if (!isObject(d)) return null;
        const value = toNum(d.value);
        if (value === null) return null;
        return typeof d.label === "string" ? { value, label: d.label } : { value };
      })
      .filter((d): d is LinePoint => d !== null);
    return { type: "line", title, data };
  }
  else if (type === "heatmap") {
    const data = (Array.isArray(panel.data) ? panel.data : [])
      .map((row) => (Array.isArray(row) ? row.map(toNum).filter((n): n is number => n !== null) : []))
      .filter((row) => row.length > 0);
    const rowLabels = Array.isArray(panel.rowLabels) ? panel.rowLabels.map(toStr) : undefined;
    return { type: "heatmap", title, data, ...(rowLabels && rowLabels.length > 0 ? { rowLabels } : {}) };
  }
  else{
    const min = toNum(panel.min);
    const max = toNum(panel.max);
    return {
      type: "gauge",
      title,
      value: toNum(panel.value) ?? 0,
      ...(typeof panel.label === "string" ? { label: panel.label } : {}),
      ...(min !== null ? { min } : {}),
      ...(max !== null ? { max } : {}),
    };
  }
  
}

function normalizeTable(input: unknown): TableSpec {
  const o = isObject(input) ? input : {};
  const columns = (Array.isArray(o.columns) ? o.columns : []).map(toStr).filter((c) => c.length > 0);
  const rawAligns = Array.isArray(o.aligns) ? o.aligns : [];
  const aligns = columns.map((_, i) => {
    const a = toStr(rawAligns[i]) as Align;
    return ALIGNS.has(a) ? a : undefined;
  });
  const rows = (Array.isArray(o.rows) ? o.rows : []).map((r) => {
    const cells = Array.isArray(r) ? r : [];
    return columns.map((_, i) => {
      const cell = cells[i];
      return typeof cell === "number" ? cell : toStr(cell);
    });
  });
  const stats = (Array.isArray(o.stats) ? o.stats : [])
    .map((s): StatItem | null => {
      if (!isObject(s)) return null;
      const key = toStr(s.key);
      if (!key) return null;
      return { key, value: toStr(s.value) };
    })
    .filter((s): s is StatItem => s !== null);

  return {
    title: toStr(o.title) || "table",
    columns,
    ...(aligns.some((a) => a !== undefined) ? { aligns: aligns.map((a) => a ?? "left") } : {}),
    rows,
    ...(stats.length > 0 ? { stats } : {}),
  };
}

function normalizeAlert(input: unknown): AlertSpec {
  const o = isObject(input) ? input : {};
  const variant = toStr(o.variant) as AlertVariant;
  return {
    variant: ALERT_VARIANTS.has(variant) ? variant : "info",
    title: toStr(o.title),
    message: toStr(o.message),
    appendix: toStr(o.appendix),
  };
}

function normalizeContext(input: unknown): ContextSpec {
  const o = isObject(input) ? input : {};
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((item): MultiProgressItem | null => {
      if (!isObject(item)) return null;
      const total = toNum(item.total);
      if (total === null) return null;
      const label = toStr(item.label);
      const status = toStr(item.status) as MultiProgressStatus;
      return {
        id: toStr(item.id) || label || "ctx",
        label,
        value: toNum(item.value) ?? 0,
        total,
        ...(PROGRESS_STATUS.has(status) ? { status } : {}),
      };
    })
    .filter((item): item is MultiProgressItem => item !== null);
  return { items };
}

const EMPTY: DashboardSpec = {
  charts: [],
  details: { title: "details", columns: [], rows: [] },
  table: { title: "table", columns: [], rows: [] },
  context: { items: [] },
  alert: { variant: "info", title: "", message: "", appendix: "" },
};

export function normalizeDashboardSpec(input: unknown, fallback: DashboardSpec = EMPTY): DashboardSpec {
  const o = isObject(input) ? input : {};
  const charts = (Array.isArray(o.charts) ? o.charts : [])
    .map(normalizeChart)
    .filter((c): c is ChartSpec => c !== null);
  const details = normalizeTable(o.details);
  const table = normalizeTable(o.table);
  const context = o.context !== undefined ? normalizeContext(o.context) : fallback.context;
  const alert = o.alert !== undefined ? normalizeAlert(o.alert) : fallback.alert;
  return {
    charts: charts.length > 0 ? charts : fallback.charts,
    details: details.columns.length > 0 ? details : fallback.details,
    table: table.columns.length > 0 ? table : fallback.table,
    context,
    alert,
  };
}

// MARK: - demo presets

const THROUGHPUT = [
  3, 5, 4, 8, 7, 6, 9, 12, 10, 14, 11, 13, 17, 15, 18, 16, 21, 19, 23, 20, 25, 22, 27, 24,
  26, 29, 28, 31, 30, 34, 33, 37, 35, 39, 38, 42, 40, 44, 43, 47,
];

// Fields shared by every demo preset. Normalization copies them, so one object is safe.
const SHARED_DEFAULTS = {
  details: {
    title: "details",
    columns: ["key", "value"],
    aligns: ["left", "left"],
    rows: [
      ["session", "ses_2f9a1c"],
      ["user", "@bitan"],
      ["started", "09:41:07"],
      ["duration", "12m 24s"],
      ["turns", 14],
      ["tools", 6],
      ["model", "qwen3.5-4b"],
      ["quant", "q5_k_m"],
      ["context", "18.4k / 32k"],
      ["memory", "412 MB"],
      ["region", "us-west-2"],
      ["status", "active"],
    ],
  },
  context: {
    items: [{ id: "tokens", label: "tokens", value: 0, total: modelParams().contextWindow, status: "done" }],
  },
  alert: {
    variant: "warning",
    title: "Default Dashboard",
    message: "Type a command or an area of interest in the input bar below to get insights from your Bee Data or Take Actions from it",
    appendix: "Try asking 'hey, what are my most recent insights?'",
  },
};

const RAW_DEFAULT: unknown = {
  charts: [
    {
      type: "bar",
      title: "requests",
      data: [
        { label: "mon", value: 32 },
        { label: "tue", value: 48 },
        { label: "wed", value: 27 },
        { label: "thu", value: 61 },
        { label: "fri", value: 55 },
        { label: "sat", value: 12 },
        { label: "sun", value: 23 },
      ],
    },
    {
      type: "sparkline",
      title: "throughput",
      data: THROUGHPUT,
      label: "history",
      color: "blue",
      variant: "gradient",
      markerIndex: THROUGHPUT.length - 1,
    },
    { type: "gauge", title: "saturation", value: 68, label: "vram" },
  ],
  table: {
    title: "sessions",
    columns: ["model", "quant", "tok/s", "p50 ms", "ctx"],
    aligns: ["left", "center", "right", "right", "left"],
    rows: [
      ["qwen3.5-0.8b", "q6_k", 42, 118, "32k"],
      ["lfm2.5-2.6b", "q5_k", 40, 121, "32k"],
      ["qwen3.5-4b", "q5_k", 19, 240, "128k"],
      ["falcon-h1-1b", "q8_0", 63, 77, "32k"],
      ["gemma4-2b", "q6_k", 28, 164, "64k"],
      ["apertus-3b", "q5_k", 22, 205, "64k"],
    ],
    stats: [
      { key: "rows", value: "6" },
      { key: "updated", value: "just now" },
    ],
  },
  ...SHARED_DEFAULTS,
};

const RAW_OPS: unknown = {
  charts: [
    {
      type: "line",
      title: "latency p50",
      data: [42, 38, 44, 41, 39, 36, 40, 37, 35, 33, 34, 31, 32, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20],
    },
    {
      type: "pie",
      title: "traffic share",
      data: [
        { label: "gateway", value: 48 },
        { label: "engine", value: 22 },
        { label: "search", value: 14 },
        { label: "billing", value: 9 },
        { label: "auth", value: 7 },
      ],
    },
    {
      type: "heatmap",
      title: "errors by hour",
      rowLabels: ["mon", "tue", "wed", "thu"],
      data: [
        [1, 3, 5, 7, 9, 6, 4, 2],
        [2, 4, 6, 8, 7, 5, 3, 1],
        [5, 6, 3, 4, 2, 7, 8, 9],
        [0, 2, 4, 6, 5, 3, 2, 1],
      ],
    },
  ],
  table: {
    title: "services",
    columns: ["service", "region", "p99 ms", "status"],
    aligns: ["left", "left", "right", "center"],
    rows: [
      ["gateway", "us-east", 128, "ok"],
      ["engine", "us-west", 412, "degraded"],
      ["search", "eu-central", 89, "ok"],
      ["billing", "ap-south", 233, "ok"],
      ["auth", "eu-west", 54, "ok"],
      ["stream", "us-east", 310, "warn"],
    ],
    stats: [
      { key: "services", value: "6" },
      { key: "degraded", value: "1" },
    ],
  },
  ...SHARED_DEFAULTS,
};

export const DEFAULT_DASHBOARD_SPEC = normalizeDashboardSpec(RAW_DEFAULT);

export const DEMO_SPECS: Record<string, DashboardSpec> = {
  default: DEFAULT_DASHBOARD_SPEC,
  ops: normalizeDashboardSpec(RAW_OPS, DEFAULT_DASHBOARD_SPEC),
};


