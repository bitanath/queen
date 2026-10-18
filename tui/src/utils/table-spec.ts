// Shared table shape for command results and answer views. Chart/dashboard
// presentation specs used to live next to this; they are gone now.

export type Align = "left" | "right" | "center";

export type StatItem = { key: string; value: string };

export type TableSpec = {
  title: string;
  columns: string[];
  aligns?: Align[];
  rows: (string | number)[][];
  stats?: StatItem[];
};

export type Row = Record<string, unknown>;

export function tableColumns(spec: TableSpec): { key: string; header: string; align: Align }[] {
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
