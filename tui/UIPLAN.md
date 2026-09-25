# UIPLAN — TermCN adoption (rainy day)

Goal: adopt TermCN (shadcn-labs/termcn, MIT) as queen's UI library in one pass —
theme spine + spinner + card + table + sparkline, every piece with a real
consumer. No dead code; bar/line/gauge and the rest stay one file-copy away
until a surface needs them.

## Why TermCN (decided)

- Real components (box-drawing table grid, 12-style spinner, card, sparkline),
  not pipe-padding tricks. Zero npm risk except tiny data deps.
- Source, not a package: copy files, fully auditable, bundler ships only imports.
- Official OpenCode theme exists (`lib/terminal-themes/opencode.ts`) — serves
  the "resembles opencode" goal directly.
- Single author, slow cadence (~3.5mo at last check) — acceptable BECAUSE copied
  source is ours; upstream silence costs nothing.

## What NOT to take (decided)

- AI chat-message / streaming-text: ours work; swapping is churn.
- Anything interactive/selectable/sortable: focus fights our input-first keymap
  (arrows/enter/esc belong to the input). Static grids only.
- The shadcn CLI: manual copy only. Our `@/*` tsconfig alias belongs to
  bee-cli and can't move; CLI would also write components.json and use its own
  paths. Rewire copied files' `@/` imports to relative paths.
- markdown-table-formatter (nvuillam): file CLI, wrong shape; its engine
  (markdown-table-prettify) is vscode-coupled. Dead end, do not revisit.

## Pieces

1. **Spine (foundation, first):** copy `hooks/use-theme.ts`, the theme
   provider, `lib/terminal-themes/opencode.ts`; mount provider at app root.
   Replaces the bespoke `theme.ts` idea — TermCN palette becomes our palette.
   Fallback themes if opencode misbehaves: dracula, then tokyo-night.
2. **Spinner:** registry `opentui/spinner` + `bun add cli-spinners` (pure data,
   Bun-safe). Adapt the ink-base `use-animation` hook (~10 lines) instead of
   pulling cross-base code sight unseen. Replaces `src/spinner.tsx` 1:1.
3. **Card:** wraps `/status` panel + pairing prompt (the two panel-shaped
   surfaces). Static only.
4. **Table:** registry `opentui/table` (+ `types.ts` iff imported). Needs the
   markdown-table bridge — `src/markdown-tables.ts` (~40 lines): split message
   text into prose/table segments, fenced-code-aware (never parse inside ```
   blocks), tolerant of ragged rows; headers from delimiter row, alignment
   from `:---:` markers. Prose → `<markdown>`, tables → `<Table>`,
   `borderColor` from palette. Parse-and-render at finalize only (when
   `streamingId` clears); raw markdown while streaming. Huge tables: slice at
   `maxRows` + "+N more" line.
5. **Sparkline:** live stream-rate pulse beside the spinner during generation
   (per-poll byte counts already exist in `streamGenerate`). Genuine use.

## Gotchas on record

- Registry: `https://termcn.dev/r/{name}.json` (shadcn registry-item schema).
  Spinner entry already inspected: deps `@opentui/react` + `cli-spinners`,
  registryDeps `opentui/use-theme` + `ink/use-animation`, per-file
  `/* @jsxImportSource @opentui/react */` pragma, `useTheme()` assumed.
- Components assume theme context — spine MUST land before any component.
- Version skew: our `@opentui` is 0.5.11; components touch only box/text/hooks.
  `tsc` per file at copy time, not faith.
- Keyboard: no focusable components in scrollback, ever (input owns keys).

## Verify

`tsc` clean → `bun run build` → pty run: spinner cycles, `/status` in a card,
pasted markdown table renders as grid, sparkline pulses during stream,
`/quit` exit 0. Eyeball ANSI on dark AND light terminals.
