import { Bot, FlaskConical, Hammer, Network, Palette, ScanEye, Search, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";

const ROLE_GLYPHS: [RegExp, LucideIcon][] = [
  [/orchestr|lead|plan/, Network],
  [/design/, Palette],
  [/build|implement|code/, Hammer],
  [/review/, ScanEye],
  [/test|qa/, FlaskConical],
  [/research|explor/, Search],
];

const HUES = [85, 180, 295, 325, 355];

function hashOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function tintStyle(name: string) {
  const hue = HUES[hashOf(name) % HUES.length];
  return {
    "--tint": `light-dark(oklch(0.5 0.09 ${hue}), oklch(0.8 0.09 ${hue}))`,
    "--tint-soft": `light-dark(oklch(0.94 0.03 ${hue}), oklch(0.3 0.04 ${hue}))`,
  } as CSSProperties;
}

export function AgentGlyph({ name, role, className }: { name: string; role: string; className?: string }) {
  const Icon = ROLE_GLYPHS.find(([pattern]) => pattern.test(role))?.[1] ?? Bot;
  return (
    <span
      aria-hidden
      style={tintStyle(name)}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-(--tint-soft) text-(--tint) ring-1 ring-inset ring-(--tint)/25 [&>svg]:size-[18px]", className)}
    >
      <Icon strokeWidth={2} />
    </span>
  );
}

type Edges = { start: boolean; end: boolean };

export function useScrollEdges(ref: RefObject<HTMLElement | null>, axis: "x" | "y", count: number) {
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const offset = axis === "x" ? element.scrollLeft : element.scrollTop;
      const room = axis === "x" ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
      const start = offset > 1;
      const end = room - offset > 1;
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [ref, axis, count]);
  return edges;
}

export function edgeFade(direction: "right" | "bottom", { start, end }: Edges): CSSProperties | undefined {
  if (!start && !end) return;
  return { maskImage: `linear-gradient(to ${direction}, ${start ? "transparent" : "#000"}, #000 1rem, #000 calc(100% - 1rem), ${end ? "transparent" : "#000"})` };
}
