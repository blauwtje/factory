export const SERIES = [
  { key: "input", label: "Input", color: "var(--chart-input)" },
  { key: "cache_write", label: "Cache write", color: "var(--chart-cache-write)" },
  { key: "output", label: "Output", color: "var(--chart-output)" },
] as const;

const MODEL_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export const modelColor = (index: number) => MODEL_COLORS[index % MODEL_COLORS.length];
