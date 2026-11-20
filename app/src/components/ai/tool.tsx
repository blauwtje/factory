import { CircleCheck, ChevronRight, CircleDashed, CircleX, Clock, Wrench, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader } from "@/components/ai/loader";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

export type ToolState = "pending" | "running" | "awaiting_approval" | "done" | "failed" | "denied";

const STATES: Record<ToolState, { label: string; ink: string; icon?: LucideIcon }> = {
  pending: { label: "Pending", ink: "text-faint", icon: CircleDashed },
  running: { label: "Running", ink: "text-running-ink" },
  awaiting_approval: { label: "Needs approval", ink: "text-approval-ink", icon: Clock },
  done: { label: "Done", ink: "text-faint", icon: CircleCheck },
  failed: { label: "Failed", ink: "text-failed-ink", icon: CircleX },
  denied: { label: "Denied", ink: "text-failed-ink", icon: CircleX },
};

export function ToolStatus({ state }: { state: ToolState }) {
  const { label, ink, icon: Icon } = STATES[state];
  return (
    <span className={cn("inline-flex items-center gap-1 text-caption [&>svg]:size-3", ink)}>
      {Icon ? <Icon /> : <Loader variant="circular" size="xs" />}
      {label}
    </span>
  );
}

export function Tool({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn("group/tool w-full overflow-hidden rounded-lg", className)} {...props} />;
}

type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  state: ToolState;
  icon?: LucideIcon;
};

export function ToolHeader({ className, title, detail, state, icon: Icon = Wrench, ...props }: ToolHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body ui-focus-inset hover:bg-raised", className)}
      {...props}
    >
      <ChevronRight className="size-3.5 shrink-0 text-faint transition-transform duration-(--duration-menu) ease-out group-data-[open]/tool:rotate-90" />
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="shrink-0">{title}</span>
      {detail !== undefined && <span className="min-w-0 truncate font-mono text-label text-muted">{detail}</span>}
      <span className="ml-auto shrink-0">
        <ToolStatus state={state} />
      </span>
    </CollapsibleTrigger>
  );
}

export function ToolContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn("ml-2 border-l border-rule pl-2", className)} {...props} />;
}

function Section({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 p-3", className)}>
      <p className="text-label font-medium text-faint">{label}</p>
      {children}
    </div>
  );
}

export function ToolInput({ input }: { input: Record<string, unknown> }) {
  if (Object.keys(input).length === 0) return null;
  return (
    <Section label="Parameters">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" className="rounded-none border-0 bg-transparent [&_pre]:p-0" />
    </Section>
  );
}

const EMPTY = new Set(["", "[]", "{}", "null"]);

export function ToolOutput({ output, isError = false }: { output: string; isError?: boolean }) {
  return (
    <Section label={isError ? "Error" : "Result"}>
      {isError ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-failed-soft p-3 font-mono text-label leading-5 text-failed-ink">{output}</pre>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-label leading-5 text-muted">{EMPTY.has(output.trim()) ? "No output" : output}</pre>
      )}
    </Section>
  );
}
