const PART_FROM_HOUR = [
  [18, "evening"],
  [12, "afternoon"],
  [5, "morning"],
] as const;

export function dayPart(date = new Date()) {
  const part = PART_FROM_HOUR.find(([from]) => date.getHours() >= from)?.[1];
  if (!part) return "Late at night";
  return `${date.toLocaleDateString("en-US", { weekday: "long" })} ${part}`;
}
