const SEPARATOR = /: | — | – | - /;

export type PlanDiff = { marks: ("new" | "changed" | undefined)[]; removed: string[] };

export function stepTitle(step: string): string {
  const plain = step.replace(/\*\*|__|`/g, "");
  const cut = plain.search(SEPARATOR);
  return (cut === -1 ? plain : plain.slice(0, cut)).trim();
}

export function planDiff(previous: string[], current: string[]): PlanDiff {
  const unpaired = previous.map((text, position) => ({ text, position, key: stepTitle(text).toLowerCase() }));
  const marks = current.map((text) => {
    const at = unpaired.findIndex((step) => step.key === stepTitle(text).toLowerCase());
    if (at === -1) return "new" as const;
    const [paired] = unpaired.splice(at, 1);
    return paired.text.trim() === text.trim() ? undefined : ("changed" as const);
  });
  const reworded = marks.map((mark, position) => {
    if (mark !== "new" || SEPARATOR.test(current[position])) return mark;
    const at = unpaired.findIndex((step) => step.position === position && !SEPARATOR.test(step.text));
    if (at === -1) return mark;
    unpaired.splice(at, 1);
    return "changed" as const;
  });
  return { marks: reworded, removed: unpaired.map((step) => step.text) };
}
