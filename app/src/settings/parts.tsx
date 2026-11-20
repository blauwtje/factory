import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const cardClass = "rounded-xl border border-edge bg-raised p-4";

type SectionProps = { title: string; description: string; wide?: boolean; fill?: boolean; aside?: ReactNode; children: ReactNode };

export function Section({ title, description, wide, fill, aside, children }: SectionProps) {
  return (
    <section aria-label={title} className={cn("flex w-full flex-col gap-6", fill ? "min-h-0 flex-1" : wide ? "max-w-[960px]" : "max-w-[720px]")}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          <h3 className="text-heading font-semibold text-ink">{title}</h3>
          <p className="text-body text-pretty text-muted">{description}</p>
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className={cn("flex flex-col gap-6", fill && "min-h-0 flex-1")}>{children}</div>
    </section>
  );
}

export function Panel({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-col gap-0.5 px-1">
        <h4 className="text-body font-medium text-ink">{title}</h4>
        {description && <p className="text-label text-pretty text-muted">{description}</p>}
      </div>
      <div className={cn(cardClass, "overflow-hidden p-0")}>{children}</div>
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-rule">{children}</dl>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 px-4 py-2.5">
      <dt className="min-w-0 flex-1 text-body text-ink">{label}</dt>
      <dd className="flex min-w-0 max-w-[70%] items-center justify-end gap-2 text-body text-ink">{children}</dd>
    </div>
  );
}

function useSaved(value: unknown) {
  const [saved, setSaved] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(timer);
  }, [value]);
  return saved;
}

export function SavedNote({ value }: { value: unknown }) {
  const saved = useSaved(value);
  return (
    <span role="status" aria-live="polite" className="text-caption text-faint">
      <AnimatePresence>
        {saved && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1, ease: ease.out } }} transition={{ duration: duration.press, ease: ease.out }}>
            Saved
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function SettingRow({ label, description, value, children }: { label: ReactNode; description: string; value: unknown; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-ink">{label}</span>
        <span className="text-label text-pretty text-muted">{description}</span>
      </div>
      <SavedNote value={value} />
      <div className="flex shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}
