// Full answer viewer. Picks the renderer by answer kind: a drill-down detail,
// search result cards, a full-width wrapping table, or markdown prose.
import { useEffect, useMemo, useRef, useState } from "react";
import { SyntaxStyle, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { Modal } from "../components/modal";
import { WrapTable } from "../components/wrap-table";
import { Matrix } from "../components/matrix";
import { SearchResults } from "../components/search-results";
import { DetailView } from "../components/detail-view";
import { Spinner } from "../components/spinner";
import { useTheme } from "../theme/use-theme";
import { tableColumns, tableRows } from "../utils/table-spec";
import { getResultDetail } from "../utils/bee-com-bridge";
import type { AnswerView } from "../utils/answer-view";

export function AnswerModal({ view, onClose }: { view: AnswerView; onClose: () => void }) {
  const theme = useTheme();
  const { width: cols, height: rows } = useTerminalDimensions();
  // Nearly full-screen for large data; Modal clamps to the terminal anyway.
  const panelW = Math.min(160, Math.max(24, cols - 4));
  const panelH = Math.max(6, rows - 2);
  // Modal content = panel - border(2) - paddingX(4); reserve 1 col for the scrollbar.
  const tableW = Math.max(20, panelW - 6 - 1);

  // Theme the OpenTUI markdown scopes so headings/emphasis/code pick up color.
  const markdownStyle = useMemo(
    () =>
      SyntaxStyle.fromTheme([
        { scope: ["markup.heading"], style: { foreground: theme.colors.primary, bold: true } },
        { scope: ["markup.strong"], style: { foreground: theme.colors.foreground, bold: true } },
        { scope: ["markup.italic"], style: { foreground: theme.colors.foreground, italic: true } },
        { scope: ["markup.raw"], style: { foreground: theme.colors.accent } },
        { scope: ["markup.raw.block"], style: { foreground: theme.colors.accent } },
        { scope: ["markup.link"], style: { foreground: theme.colors.info, underline: true } },
        { scope: ["markup.link.label"], style: { foreground: theme.colors.info, underline: true } },
        { scope: ["markup.link.url"], style: { foreground: theme.colors.mutedForeground } },
        { scope: ["markup.list"], style: { foreground: theme.colors.mutedForeground } },
        { scope: ["markup.quote"], style: { foreground: theme.colors.mutedForeground, italic: true } },
        { scope: ["markup.strikethrough"], style: { dim: true } },
      ]),
    [theme],
  );

  // A small view stack so results can drill into the full entity and come back.
  const [stack, setStack] = useState<AnswerView[]>([view]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const current = stack[stack.length - 1] ?? view;
  const results = current.results;
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    setStack([view]);
    setSelected(0);
    setLoading(null);
  }, [view]);

  // Keep the selected search result scrolled into view as the user arrows.
  useEffect(() => {
    if (!current.results) return;
    scrollRef.current?.scrollChildIntoView(`search-result-${selected}`);
  }, [selected, current]);

  const goBack = () => {
    if (stack.length > 1) {
      setStack((s) => s.slice(0, -1));
      setSelected(0);
    } else {
      onClose();
    }
  };

  const openResult = async (index: number) => {
    const result = results?.[index];
    if (!result) return;
    setLoading(`Loading ${result.type}…`);
    try {
      const detail = await getResultDetail(result);
      setStack((s) => [...s, detail]);
      setSelected(0);
    } catch (e) {
      setStack((s) => [
        ...s,
        {
          title: `${result.type} · ${result.id}`,
          markdown: `Failed to load ${result.type}: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setLoading(null);
    }
  };

  useKeyboard((key) => {
    if (loading || !results || results.length === 0) return;
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      setSelected((c) =>
        key.name === "up" ? (c - 1 + results.length) % results.length : (c + 1) % results.length,
      );
      return;
    }
    if (key.name === "return" || key.name === "space") {
      key.preventDefault();
      void openResult(selected);
    }
  });

  const title = stack.length > 1 ? `‹ ${current.title}` : current.title;

  return (
    <Modal title={title} width={panelW} height={panelH} onClose={goBack}>
      {loading ? (
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={loading} />
        </box>
      ) : current.detail ? (
        <scrollbox flexGrow={1} minHeight={0}>
          <DetailView detail={current.detail} markdownStyle={markdownStyle} />
        </scrollbox>
      ) : current.results ? (
        <scrollbox ref={scrollRef} flexGrow={1} minHeight={0}>
          <SearchResults results={current.results} selected={selected} onOpen={openResult} />
        </scrollbox>
      ) : current.matrix || current.table || current.tables || current.pending ? (
        <scrollbox flexGrow={1} minHeight={0}>
          {current.matrix && (
            <Matrix
              rowLabels={current.matrix.rowLabels}
              colLabels={current.matrix.colLabels}
              data={current.matrix.data}
              totalWidth={tableW}
            />
          )}
          {current.table && (
            <box marginTop={current.matrix ? 1 : 0}>
              <WrapTable columns={tableColumns(current.table)} data={tableRows(current.table)} totalWidth={tableW} />
            </box>
          )}
          {current.tables?.map((t, i) => (
            <box key={i} marginTop={i === 0 && !current.matrix && !current.table ? 0 : 1}>
              <WrapTable columns={tableColumns(t)} data={tableRows(t)} totalWidth={tableW} />
            </box>
          ))}
          {current.pending && (
            <box marginTop={1}>
              <Spinner label={current.pending} />
            </box>
          )}
        </scrollbox>
      ) : (
        <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="top">
          <markdown
            content={current.markdown ?? ""}
            syntaxStyle={markdownStyle}
            streaming={false}
            tableOptions={{ widthMode: "full", style: "grid" }}
          />
        </scrollbox>
      )}
    </Modal>
  );
}
