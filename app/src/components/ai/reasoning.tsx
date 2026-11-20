import { code } from "@streamdown/code";
import { Brain, ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const AUTO_CLOSE_MS = 1000;

const ReasoningContext = createContext<{ streaming: boolean; seconds?: number }>({ streaming: false });

type ReasoningProps = Omit<ComponentProps<typeof Collapsible>, "open" | "onOpenChange"> & { streaming?: boolean; seconds?: number };

export function Reasoning({ className, streaming = false, seconds, defaultOpen, ...props }: ReasoningProps) {
  const [open, setOpen] = useState(defaultOpen ?? streaming);
  const [phase, setPhase] = useState<"idle" | "streaming" | "finished">(streaming ? "streaming" : "idle");

  if (streaming && phase !== "streaming") {
    setPhase("streaming");
    setOpen(true);
  }
  if (!streaming && phase === "streaming") setPhase("finished");

  useEffect(() => {
    if (phase !== "finished") return;
    const timer = window.setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <ReasoningContext.Provider value={{ streaming, seconds }}>
      <Collapsible className={cn("group/reasoning", className)} open={open} onOpenChange={setOpen} {...props} />
    </ReasoningContext.Provider>
  );
}

function thinkingLabel(streaming: boolean, seconds?: number) {
  if (streaming) return <TextShimmer>Thinking…</TextShimmer>;
  if (seconds === undefined) return <span>Thought for a few seconds</span>;
  return <span>Thought for {seconds}s</span>;
}

export function ReasoningTrigger({ className, children, ...props }: ComponentProps<typeof CollapsibleTrigger>) {
  const { streaming, seconds } = useContext(ReasoningContext);
  return (
    <CollapsibleTrigger
      className={cn("flex items-center gap-2 text-body text-muted ui-focus transition-colors duration-(--duration-press) hover:text-ink", className)}
      {...props}
    >
      {children ?? (
        <>
          <Brain className="size-4" />
          {thinkingLabel(streaming, seconds)}
          <ChevronDown className="size-3.5 transition-transform duration-(--duration-menu) ease-out group-data-[open]/reasoning:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

const plugins = { code };

export function ReasoningContent({ className, children, ...props }: Omit<ComponentProps<typeof CollapsibleContent>, "children"> & { children: string }) {
  return (
    <CollapsibleContent className={cn("text-body text-muted", className)} {...props}>
      <div className="prose-chat mt-2 border-l-2 border-rule pl-3">
        <Streamdown plugins={plugins}>{children}</Streamdown>
      </div>
    </CollapsibleContent>
  );
}
