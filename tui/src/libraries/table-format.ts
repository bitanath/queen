// Table formatting logic ported from nvuillam/markdown-table-formatter
// (via its engine markdown-table-prettify): column width = max(header, cells),
// alignment from `:---:` markers. We keep the pure string math and drop the
// vscode/file-CLI wrapper, then add `fitWidths` so a rendered grid always fills
// its pane exactly.

export type Align = "left" | "right" | "center";

export interface ParsedTable {
  headers: string[];
  aligns: Align[];
  rows: string[][];
}

const DELIM_CELL = /^:?-{1,}:?$/;

const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
};

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
};

/// Parse a GitHub-flavoured markdown table into headers, aligns and rows.
/// Returns null when the text is not a table (or has no delimiter row).
export const parseMarkdownTable = (md: string): ParsedTable | null => {
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headers = splitRow(lines[0] ?? "");
  const delim = splitRow(lines[1] ?? "");
  if (delim.length === 0 || !delim.every((c) => DELIM_CELL.test(c))) return null;

  const aligns = delim.map(alignOf);
  const rows = lines.slice(2).map(splitRow);
  return { headers, aligns, rows };
};

/// Natural content width per column: max(header, every cell).
export const naturalWidths = (headers: string[], rows: string[][]): number[] =>
  headers.map((header, i) => {
    let width = header.length;
    for (const row of rows) {
      width = Math.max(width, (row[i] ?? "").length);
    }
    return width;
  });

/// Resize natural column widths so the rendered table totals `total` columns.
/// Rendered width = sum(w) + 3n + 1 (each cell is " c ", `|` separators, two
/// outer borders). Grows round-robin so columns stay evenly spaced; shrinks the
/// widest first, never below `min`.
export const fitWidths = (
  natural: number[],
  total: number,
  min = 3,
): number[] => {
  const n = natural.length;
  if (n === 0) return [];

  const widths = natural.map((w) => Math.max(min, Math.floor(w)));
  const space = Math.max(n * min, Math.floor(total) - 3 * n - 1);
  let sum = widths.reduce((a, b) => a + b, 0);

  if (sum < space) {
    let extra = space - sum;
    let i = 0;
    while (extra > 0) {
      const idx = i % n;
      widths[idx] = (widths[idx] ?? min) + 1;
      extra -= 1;
      i += 1;
    }
  } else if (sum > space) {
    while (sum > space) {
      let widest = -1;
      for (let i = 0; i < n; i += 1) {
        const w = widths[i] ?? 0;
        if (w > min && (widest === -1 || w > (widths[widest] ?? 0))) widest = i;
      }
      if (widest === -1) break;
      widths[widest] = (widths[widest] ?? min) - 1;
      sum -= 1;
    }
  }

  return widths;
};

/// Pad/truncate a cell to `width` with the given alignment.
export const padCell = (
  value: string,
  width: number,
  align: Align = "left",
): string => {
  const s = String(value);
  if (s.length >= width) return s.slice(0, width);
  const diff = width - s.length;
  if (align === "right") return " ".repeat(diff) + s;
  if (align === "center") {
    const left = Math.floor(diff / 2);
    return " ".repeat(left) + s + " ".repeat(diff - left);
  }
  return s + " ".repeat(diff);
};
