import { Check, FileText, ListChecks } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Plan, PlanAction, PlanContent, PlanFooter, PlanHeader, PlanTitle, PlanTrigger } from "@/components/ai/plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { planDiff, stepTitle, type PlanDiff } from "./planDiff";
import { splitPlan } from "./rows";
import { inputText } from "./tools";
import type { ChatItem, ToolItem } from "./types";

type AssistantItem = Extract<ChatItem, { kind: "assistant" }>;

export type PlanPhase = "draft" | "review" | "building" | "done";

const TITLES: Record<PlanPhase, string> = {
  draft: "Plan",
  review: "Plan ready for approval",
  building: "Building the plan",
  done: "Plan done",
};

const STEP_LIST = "flex flex-col gap-2 [--plan-dot:1.25rem]";

const rail = "relative pb-1 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:-bottom-2 [&:not(:last-child)]:before:left-[calc(var(--plan-dot)/2)] [&:not(:last-child)]:before:top-[calc(var(--plan-dot)+0.25rem)] [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:-translate-x-1/2 [&:not(:last-child)]:before:bg-edge";

const REVIEW_TINT = "border-[color-mix(in_oklab,var(--approval)_40%,var(--edge))] bg-[color-mix(in_oklab,var(--approval-soft)_35%,transparent)]";

function commentsMessage(steps: string[], comments: string[]): string {
  const lines = steps.flatMap((step, index) => {
    const comment = (comments[index] ?? "").trim();
    return comment ? [`- Step ${index + 1} (${stepTitle(step)}): ${comment}`] : [];
  });
  return ["Comments on the plan:", ...lines].join("\n");
}

function Numbered({ steps, streaming, diff, onComments }: { steps: string[]; streaming: boolean; diff?: PlanDiff; onComments?: (text: string) => void }) {
  const [comments, setComments] = useState<string[]>([]);
  const blank = comments.every((comment) => !comment.trim());
  const sendComments = () => {
    onComments?.(commentsMessage(steps, comments));
    setComments([]);
  };
  return (
    <>
    <ol className={STEP_LIST}>
      {steps.map((step, index) => (
        <li key={index} className={cn("flex gap-3", rail)}>
          <span className="relative mt-px flex size-(--plan-dot) shrink-0 items-center justify-center rounded-full bg-active text-label font-medium text-muted tabular-nums">
            {index + 1}
          </span>
          <Markdown streaming={streaming && index === steps.length - 1} className="text-body text-ink">
            {step}
          </Markdown>
          {diff?.marks[index] && (
            <Badge variant="outline" className="mt-px shrink-0">
              {diff.marks[index] === "new" ? "New" : "Changed"}
            </Badge>
          )}
          {onComments && (
            <Input
              aria-label={`Comment on step ${index + 1}`}
              value={comments[index] ?? ""}
              onChange={(event) => setComments((current) => Object.assign([...current], { [index]: event.target.value }))}
              className="mt-px w-56 shrink-0"
            />
          )}
        </li>
      ))}
    </ol>
    {onComments && (
      <Button variant="outline" size="sm" disabled={blank} onClick={sendComments} className="self-start">
        Send comments
      </Button>
    )}
    {diff && diff.removed.length > 0 && (
      <div className="flex flex-col gap-1">
        <p className="text-label text-muted">Removed since the last version</p>
        <ul className="flex flex-col gap-1">
          {diff.removed.map((step, index) => (
            <li key={index}>
              <Markdown className="text-label text-muted line-through">{step}</Markdown>
            </li>
          ))}
        </ul>
      </div>
    )}
    </>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-3 text-label text-muted">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-active">
        <div className="h-full origin-left rounded-full bg-done transition-transform duration-(--duration-panel) ease-out" style={{ transform: `scaleX(${done / total})` }} />
      </div>
      <span className="shrink-0 tabular-nums">
        Your checklist · {done} of {total}
      </span>
    </div>
  );
}

function Checklist({ steps, finished }: { steps: string[]; finished: boolean }) {
  const id = useId();
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const isDone = (index: number) => finished || ticked.has(index);
  const toggle = (index: number) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  return (
    <>
      <Progress done={steps.filter((_, index) => isDone(index)).length} total={steps.length} />
      <ul className={STEP_LIST}>
        {steps.map((step, index) => (
          <li key={index} className={cn("group/step flex gap-3 rounded-md", rail)}>
            <button
              type="button"
              role="checkbox"
              aria-checked={isDone(index)}
              aria-labelledby={`${id}-${index}`}
              disabled={finished}
              onClick={() => toggle(index)}
              className={cn(
                "relative mt-px flex size-(--plan-dot) shrink-0 items-center justify-center rounded-full border ui-focus transition-colors duration-(--duration-press) after:absolute after:-inset-1.5",
                isDone(index) ? "border-done bg-done text-surface" : "border-control bg-surface text-transparent group-hover/step:border-done",
              )}
            >
              <Check className={cn("size-3 transition-transform duration-(--duration-press)", isDone(index) ? "scale-100" : "scale-90")} strokeWidth={3} aria-hidden />
            </button>
            <div id={`${id}-${index}`} className="min-w-0 flex-1">
              <Markdown className={cn("text-body transition-colors duration-(--duration-panel)", isDone(index) ? "text-muted" : "text-ink")}>{step}</Markdown>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PlanCard({ tool, message, previous, phase = "draft", onComments }: { tool: ToolItem; message?: AssistantItem; previous?: string; phase?: PlanPhase; onComments?: (text: string) => void }) {
  const streaming = !tool.result || (message?.streaming ?? false);
  const plan = splitPlan(message?.text ?? "");
  const path = inputText(tool.input, "path");
  const model = inputText(tool.input, "build_model");
  const effort = inputText(tool.input, "build_effort");
  const why = inputText(tool.input, "why");
  const tracking = (phase === "building" || phase === "done") && !streaming && plan.steps.length > 0;
  const diff = previous === undefined || streaming ? undefined : planDiff(splitPlan(previous).steps, plan.steps);
  const title = streaming ? "Writing the plan" : TITLES[phase];
  return (
    <section aria-label="Plan">
      <Plan defaultOpen streaming={streaming} className={cn("relative overflow-hidden", phase === "review" && !streaming && REVIEW_TINT)}>
        <PlanHeader className="items-center border-b border-rule py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex size-5 shrink-0 items-center justify-center", phase === "done" ? "text-done" : "text-muted")}>
              <ListChecks className="size-4" aria-hidden />
            </span>
            <div className="relative min-w-0">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={title}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.15, ease: ease.out } }}
                  exit={{ opacity: 0, transition: { duration: duration.press, ease: ease.out } }}
                >
                  <PlanTitle>{title}</PlanTitle>
                </motion.div>
              </AnimatePresence>
              {path && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-label text-muted">
                  <FileText className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{path}</span>
                </p>
              )}
            </div>
          </div>
          <PlanAction>
            {model && (
              <Badge variant="outline">
                {effort ? `${model} · ${effort}` : model}
              </Badge>
            )}
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent keepMounted className="flex flex-col gap-4 pt-4">
          {plan.intro && <Markdown className="text-body text-muted">{plan.intro}</Markdown>}
          {tracking ? (
            <Checklist steps={plan.steps} finished={phase === "done"} />
          ) : (
            plan.steps.length > 0 && <Numbered steps={plan.steps} streaming={message?.streaming ?? false} diff={diff} onComments={phase === "review" && !streaming ? onComments : undefined} />
          )}
          {why && <p className="border-l border-edge pl-3 text-label text-muted">{why}</p>}
        </PlanContent>
        {plan.outro && (
          <PlanFooter className="justify-start bg-raised">
            <Markdown className="text-body text-muted">{plan.outro}</Markdown>
          </PlanFooter>
        )}
      </Plan>
    </section>
  );
}
