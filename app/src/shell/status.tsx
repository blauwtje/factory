import { Check, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type JobStatus } from "./types";

export const STATUS_TONE = {
  planning: "running",
  waiting: "waiting",
  building: "running",
  awaiting_approval: "approval",
  done: "done",
  merged: "waiting",
  failed: "failed",
} as const satisfies Record<JobStatus, string>;

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden data-loader className={cn("size-3 shrink-0 animate-spin text-muted [animation-duration:1.2s]", className)}>
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.3" />
      <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StatusIcon({ status, className }: { status: JobStatus; className?: string }) {
  switch (status) {
    case "planning":
    case "building":
      return <Spinner className={className} />;
    case "awaiting_approval":
      return (
        <span aria-hidden className={cn("flex size-3 shrink-0 items-center justify-center", className)}>
          <span className="size-1.5 rounded-full bg-approval" />
        </span>
      );
    case "waiting":
      return (
        <span aria-hidden className={cn("flex size-3 shrink-0 items-center justify-center", className)}>
          <span className="size-2 rounded-full border-[1.5px] border-waiting" />
        </span>
      );
    case "done":
      return <span aria-hidden className={cn("flex size-3 shrink-0 items-center justify-center", className)}>
          <span className="size-1.5 rounded-full bg-done" />
        </span>;
    case "merged":
      return <Check aria-hidden className={cn("size-3 shrink-0 text-faint", className)} />;
    case "failed":
      return <CircleX aria-hidden className={cn("size-3 shrink-0 text-failed", className)} />;
  }
}

const DOT_CLASS = {
  running: "bg-running",
  approval: "bg-approval shadow-[0_0_0_3px_var(--approval-soft)]",
  done: "bg-done",
  waiting: "border-[1.5px] border-waiting",
  failed: "bg-failed",
} as const satisfies Record<(typeof STATUS_TONE)[JobStatus], string>;

export const STATUS_WORD: Partial<Record<JobStatus, { word: string; className: string }>> = {
  awaiting_approval: { word: "Review", className: "text-approval-ink" },
  failed: { word: "Failed", className: "text-failed-ink" },
};

export function StatusDot({ status, className }: { status: JobStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  const shape = status === "planning" ? "border-[1.5px] border-dashed border-running bg-transparent" : DOT_CLASS[tone];
  return <span aria-hidden data-tone={tone} className={cn("status-dot relative size-2 shrink-0 rounded-full", shape, className)} />;
}

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-label text-muted">
      <StatusIcon status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}
