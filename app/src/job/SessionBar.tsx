import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { CircleCheck, CircleX, GitMerge, Hand, Loader2, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { duration, ease } from "@/lib/motion";
import { isMac } from "@/lib/platform";
import { usePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import type { Summary, Tone } from "./summary";

export type Action = { kind: "approve" | "merge"; run: () => Promise<void> };

type Look = { icon: LucideIcon; ink: string; title: string; band?: string };

const TONES: Record<Tone, Look> = {
  approval: { icon: Hand, ink: "text-approval-ink", title: "text-approval-ink", band: "bg-approval-soft" },
  running: { icon: Sparkles, ink: "text-running", title: "text-ink" },
  done: { icon: CircleCheck, ink: "text-done", title: "text-ink" },
  failed: { icon: CircleX, ink: "text-failed-ink", title: "text-failed-ink", band: "bg-failed-soft" },
};

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function useShortcut(action: Action | undefined, run: () => void) {
  useEffect(() => {
    if (action?.kind !== "approve") return;
    const onKey = (event: KeyboardEvent) => {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.key !== "Enter" || isTyping(event.target)) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, run]);
}

const onAccent = "border-transparent bg-accent-ink/15 text-accent-ink";

function ConfirmMerge({ pending, onConfirm, children }: { pending: boolean; onConfirm: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const confirm = () => {
    setOpen(false);
    onConfirm();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button disabled={pending} className="shrink-0 gap-1.5" />}>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="end">
        <PopoverTitle>Merge the changes?</PopoverTitle>
        <PopoverDescription>Every agent's finished changes go into your current branch in one merge commit.</PopoverDescription>
        <div className="mt-1 flex justify-end gap-2">
          <PopoverClose render={<Button variant="ghost" size="sm" />}>Cancel</PopoverClose>
          <Button size="sm" autoFocus onClick={confirm}>
            Confirm merge
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ActionButton({ action }: { action: Action }) {
  const [pending, setPending] = useState(false);
  const [confirmMerge] = usePref("confirmMerge", true);
  const run = async () => {
    if (pending) return;
    setPending(true);
    await action.run().finally(() => setPending(false));
  };
  useShortcut(action, run);
  const spinner = pending && <Loader2 aria-hidden data-loader className="animate-spin" />;
  if (action.kind === "approve") {
    return (
      <Button onClick={run} disabled={pending} aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"} className="shrink-0 gap-2 pr-2">
        Approve
        {spinner || (
          <KbdGroup aria-hidden>
            <Kbd className={onAccent}>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd className={onAccent}>↵</Kbd>
          </KbdGroup>
        )}
      </Button>
    );
  }
  const label = (
    <>
      {spinner || <GitMerge aria-hidden />}
      Merge
    </>
  );
  if (confirmMerge) return <ConfirmMerge pending={pending} onConfirm={run}>{label}</ConfirmMerge>;
  return (
    <Button onClick={run} disabled={pending} className="shrink-0 gap-1.5">
      {label}
    </Button>
  );
}

export function SessionStatus({ summary }: { summary: Summary }) {
  const look = TONES[summary.tone];
  const Icon = look.icon;
  return (
    <section aria-label="Session status" aria-live="polite" className="chat-column pt-3">
      <motion.div
        key={look.band ? summary.tone : "quiet"}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.panel, ease: ease.out }}
        className={cn("flex items-start gap-2.5 text-label", look.band && ["-mx-3 rounded-lg px-3 py-2", look.band])}
      >
        <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", look.ink)} />
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className={cn("min-w-0 font-medium [overflow-wrap:anywhere]", look.title)}>{summary.title}</span>
          <span className="text-pretty text-muted">{summary.detail}</span>
        </p>
      </motion.div>
    </section>
  );
}
