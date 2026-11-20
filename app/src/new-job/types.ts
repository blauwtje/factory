export const MODELS = [
  { id: "claude-fable-5-2", label: "Fable 5.2", hint: "The largest model, for the hardest problems" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Plans, reviews and debugs with care" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Fast everyday building and testing" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Quickest, for small mechanical edits" },
] as const;
export const EFFORTS = [
  { id: "low", hint: "Short answers, light on limits" },
  { id: "medium", hint: "Everyday work" },
  { id: "high", hint: "Thinks it through before acting" },
  { id: "xhigh", hint: "Hard, many-step problems" },
  { id: "max", hint: "Thinks longest, uses the most limits" },
] as const;

export type Choice = { value: string; label: string; hint?: string; isDefault?: boolean };

export const MODEL_ITEMS: Choice[] = MODELS.map(({ id, label, hint }) => ({ value: id, label, hint }));
export const EFFORT_ITEMS: Choice[] = EFFORTS.map(({ id, hint }) => ({ value: id, label: id === "xhigh" ? "Extra high" : id[0].toUpperCase() + id.slice(1), hint }));

export const markDefault = (items: readonly Choice[], value: string | undefined): Choice[] => items.map((item) => ({ ...item, isDefault: item.value === value }));
export const resolveChoice = (items: readonly Choice[], value: string) => value || items.find((item) => item.isDefault)?.value || "";
export const storedChoice = (items: readonly Choice[], next: string) => (items.find((item) => item.value === next)?.isDefault ? "" : next);
