// Dummy datasets for the dashboard bento. The table is authored as markdown so
// its alignment markers exercise the ported table-formatter logic.
export const REQUEST_BARS = [
  { label: "mon", value: 32 },
  { label: "tue", value: 48 },
  { label: "wed", value: 27 },
  { label: "thu", value: 61 },
];

export const THROUGHPUT = [
  3, 5, 4, 8, 7, 6, 9, 12, 10, 14, 11, 13, 17, 15, 18, 16, 21, 19, 23, 20, 25,
  22, 27, 24,
];

export const SATURATION = 68;

export const TABLE_MD = [
  "| model         | quant | tok/s | p50 ms | ctx   |",
  "| :------------ | :---: | ----: | -----: | :---- |",
  "| qwen3.5-0.8b  | q6_k  |    42 |    118 | 32k   |",
  "| lfm2.5-230m   | q8_0  |    97 |     41 | 16k   |",
  "| qwen3.5-4b    | q5_k  |    19 |    240 | 128k  |",
  "| falcon-h1-1b  | q8_0  |    63 |     77 | 32k   |",
  "| gemma4-2b     | q6_k  |    28 |    164 | 64k   |",
  "| apertus-3b    | q5_k  |    22 |    205 | 64k   |",
].join("\n");

export const TABLE_STATS = [
  { key: "rows", value: "6" },
  { key: "updated", value: "just now" },
];

export const HEATMAP_DATA = [
  [1, 3, 5, 7, 9],
  [2, 4, 6, 8, 7],
  [5, 6, 3, 4, 2],
];
