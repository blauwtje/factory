import { ChevronRight, CircleX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { CopyButton } from "@/components/ai/code-block";
import { ToolInput, ToolOutput } from "@/components/ai/tool";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { DiffView, lineCounts, type LineCounts } from "./DiffView";
import { copyLabel, errorLine, inputText, readableName, toolDuration, toolKind, toolState, toolTarget, summaryParts, type ToolState } from "./tools";
import type { ToolItem } from "./types";

const STATUS_LABELS = { running: "Running", done: "Done" } as const;

const DIFF_TOOLS = new Set(["Edit", "Write"]);

function diffSides(item: ToolItem): { before: string; after: string } {
  if (item.name === "Write") return { before: "", after: inputText(item.input, "content") };
  return { before: inputText(item.input, "old_string"), after: inputText(item.input, "new_string") };
}

function Counts({ counts }: { counts: LineCounts }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-label tabular-nums">
      <span className="text-diff-add">+{counts.added}</span>
      {counts.removed > 0 && <span className="text-diff-remove">−{counts.removed}</span>}
    </span>
  );
}

type RowHeaderProps = {
  verb: ReactNode;
  label?: string;
  target?: string;
  path?: string;
  mono?: boolean;
  state: ToolState;
  extra?: ReactNode;
  copy?: string;
};

const openFile = (path: string) => () => void openPath(path).catch(() => undefined);

function RowHeader({ verb, label, target, path, mono = true, state, extra, copy }: RowHeaderProps) {
  return (
    <div className="group/row relative">
      <div className={cn("flex h-7 min-w-0 items-center gap-1.5 text-label text-muted", copy && target && "pr-7")}>
        <CollapsibleTrigger
          aria-label={label}
          className={cn(
            "ui-press group/trigger flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-left ui-focus-inset transition-colors duration-(--duration-press) hover:text-ink data-[panel-open]:text-ink",
            "after:absolute after:inset-0 after:content-['']",
          )}
        >
          <ChevronRight
            className="size-3.5 shrink-0 text-faint transition-[rotate] duration-(--duration-menu) ease-out group-data-[panel-open]/trigger:rotate-90"
            aria-hidden
          />
          {state === "failed" ? <CircleX className="size-3.5 shrink-0 text-failed" aria-label="Failed" /> : <span role="img" className="sr-only" aria-label={STATUS_LABELS[state]} />}
          <span>{verb}</span>
        </CollapsibleTrigger>
        {target && path ? (
          <button
            type="button"
            onClick={openFile(path)}
            className="relative min-w-0 cursor-pointer truncate rounded-sm font-mono text-label text-faint ui-focus transition-colors duration-(--duration-press) hover:text-ink hover:underline"
            title={target}
          >
            {target}
          </button>
        ) : (
          target && (
            <span className={cn("min-w-0 truncate text-faint", mono && "font-mono text-label")} title={target}>
              {target}
            </span>
          )
        )}
        {extra && <span className="ml-auto flex shrink-0 items-center gap-2">{extra}</span>}
      </div>
      {copy && target && (
        <CopyButton
          text={target}
          label={copy}
          className="absolute top-1/2 right-0 z-10 -translate-y-1/2 text-faint opacity-0 transition-opacity duration-(--duration-press) group-hover/row:opacity-100 hover:text-ink focus-visible:opacity-100"
        />
      )}
    </div>
  );
}

function Panel({ tall, children }: { tall: boolean; children: ReactNode }) {
  return (
    <CollapsibleContent keepMounted data-tall={tall || undefined}>
      <div className="mt-1 mb-2 ml-5 overflow-hidden rounded-md bg-raised">{children}</div>
    </CollapsibleContent>
  );
}

function Terminal({ command, output, failed }: { command: string; output?: string; failed: boolean }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap bg-raised p-3 font-mono text-label leading-5">
      <span className="text-ink">{`$ ${command}`}</span>
      {output !== undefined && (
        <span className={cn("mt-2 block pt-2", failed ? "text-failed-ink" : "text-muted")}>{output.trim() ? output : "No output"}</span>
      )}
    </pre>
  );
}

function Body({ item }: { item: ToolItem }) {
  const failed = item.result?.is_error ?? false;
  if (DIFF_TOOLS.has(item.name)) {
    const { before, after } = diffSides(item);
    return (
      <>
        <DiffView path={inputText(item.input, "file_path")} before={before} after={after} />
        {failed && item.result && <ToolOutput output={item.result.output} isError />}
      </>
    );
  }
  if (item.name === "Bash") return <Terminal command={inputText(item.input, "command")} output={item.result?.output} failed={failed} />;
  if (item.name === "Read") {
    if (!item.result) return <ToolInput input={item.input} />;
    return <ToolOutput output={item.result.output} isError={failed} />;
  }
  return (
    <>
      <ToolInput input={item.input} />
      {item.result && <ToolOutput output={item.result.output} isError={failed} />}
    </>
  );
}

export function ToolRow({ item }: { item: ToolItem }) {
  const kind = toolKind(item.name);
  const state = toolState(item);
  const duration = toolDuration(item);
  const diff = DIFF_TOOLS.has(item.name);
  const sides = diffSides(item);
  const failure = errorLine(item);
  const isPath = kind.target === "file_path";
  const target = toolTarget(item);
  return (
    <div role="group" aria-label={`Tool ${readableName(item.name)}`}>
      <Collapsible>
        <RowHeader
          verb={state === "running" ? <TextShimmer>{kind.running}</TextShimmer> : kind.done}
          label={target ? `${state === "running" ? kind.running : kind.done} ${target}` : undefined}
          target={target || undefined}
          path={isPath ? target : undefined}
          mono={kind.target !== "name" && kind.target !== "description"}
          state={state}
          copy={copyLabel(item)}
          extra={
            <>
              {diff && <Counts counts={lineCounts(sides.before, sides.after)} />}
              {duration && <span className="font-mono text-caption text-faint tabular-nums">{duration}</span>}
            </>
          }
        />
        {failure && <p className="ml-5 truncate text-label text-failed-ink">{failure}</p>}
        <Panel tall={diff}>
          <Body item={item} />
        </Panel>
      </Collapsible>
    </div>
  );
}

function Summary({ items }: { items: ToolItem[] }) {
  const running = items.some((item) => !item.result);
  const parts = summaryParts(items);
  if (!running) return <>{parts.map(({ verb, rest }) => `${verb} ${rest}`).join(", ")}</>;
  return (
    <>
      {parts.map(({ verb, rest }, index) => (
        <span key={verb}>
          {index > 0 && ", "}
          <TextShimmer>{verb}</TextShimmer> {rest}
        </span>
      ))}
      …
    </>
  );
}

export function ToolGroup({ items }: { items: ToolItem[] }) {
  const running = items.some((item) => !item.result);
  const failed = items.some((item) => item.result?.is_error);
  const state: ToolState = running ? "running" : failed ? "failed" : "done";
  const [chosen, setChosen] = useState<boolean>();
  return (
    <div role="group" aria-label="Tool group">
      <Collapsible open={chosen ?? failed} onOpenChange={setChosen}>
        <RowHeader verb={<Summary items={items} />} state={state} />
        <CollapsibleContent keepMounted>
          <div className="ml-2 border-l border-rule pl-3">
            {items.map((item) => (
              <ToolRow key={item.id} item={item} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
