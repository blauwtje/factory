import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[72%]" fill="currentColor">
        <path d="M3 19V7l6 4.5V7l6 4.5V7l6 4.5V19z" />
      </svg>
    </span>
  );
}

const HUES = [240, 190, 110, 75, 150, 215, 130, 35];

function hue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

export function ProjectAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: `light-dark(oklch(0.46 0.06 ${hue(name)}), oklch(0.66 0.06 ${hue(name)}))` }}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-micro font-medium uppercase leading-none text-accent-ink",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
