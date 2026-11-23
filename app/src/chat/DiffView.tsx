import { MultiFileDiff } from "@pierre/diffs/react";
import { diffLines } from "diff";
import { registerCustomTheme } from "@pierre/diffs";
import type { CSSProperties } from "react";
import { FACTORY_DARK, FACTORY_LIGHT, SYNTAX_THEMES } from "@/components/ai/syntax-theme";
import { useScheme } from "@/lib/theme";

export type LineCounts = { added: number; removed: number };

export function lineCounts(before: string, after: string): LineCounts {
  const counts = { added: 0, removed: 0 };
  for (const change of diffLines(before, after)) {
    if (change.added) counts.added += change.count;
    if (change.removed) counts.removed += change.count;
  }
  return counts;
}

registerCustomTheme(FACTORY_LIGHT.name, async () => FACTORY_LIGHT);
registerCustomTheme(FACTORY_DARK.name, async () => FACTORY_DARK);

const THEME = SYNTAX_THEMES;

const BACKGROUND_CSS = ":host { --diffs-light-bg: var(--raised); --diffs-dark-bg: var(--raised); }";

const TOKENS = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "20px",
  "--diffs-bg-addition-override": "var(--diff-add-bg)",
  "--diffs-bg-addition-number-override": "var(--diff-add-bg)",
  "--diffs-bg-addition-emphasis-override": "var(--diff-add-strong)",
  "--diffs-bg-deletion-override": "var(--diff-remove-bg)",
  "--diffs-bg-deletion-number-override": "var(--diff-remove-bg)",
  "--diffs-bg-deletion-emphasis-override": "var(--diff-remove-strong)",
  "--diffs-addition-color-override": "var(--diff-add)",
  "--diffs-deletion-color-override": "var(--diff-remove)",
} as CSSProperties;

export type DiffLine = { number: number; side: "old" | "new" };

const endLine = (text: string) => (text && !text.endsWith("\n") ? `${text}\n` : text);

export function DiffView({
  path,
  before,
  after,
  onLineClick,
  split = false,
}: {
  path: string;
  before: string;
  after: string;
  onLineClick?: (line: DiffLine) => void;
  split?: boolean;
}) {
  const scheme = useScheme();
  return (
    <MultiFileDiff
      oldFile={{ name: path, contents: endLine(before) }}
      newFile={{ name: path, contents: endLine(after) }}
      className="block max-h-96 overflow-auto"
      style={TOKENS}
      options={{
        theme: THEME,
        themeType: scheme,
        diffStyle: split ? "split" : "unified",
        diffIndicators: "classic",
        disableFileHeader: true,
        overflow: "scroll",
        hunkSeparators: "line-info",
        unsafeCSS: BACKGROUND_CSS,
        onLineNumberClick: onLineClick && (({ lineNumber, annotationSide }) => onLineClick({ number: lineNumber, side: annotationSide === "deletions" ? "old" : "new" })),
      }}
    />
  );
}
