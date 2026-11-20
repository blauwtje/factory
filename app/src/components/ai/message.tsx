import { code } from "@streamdown/code";
import { memo, type ComponentProps, type HTMLAttributes } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MessageRole = "user" | "assistant";

export function Message({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: MessageRole }) {
  return (
    <div
      data-role={from}
      className={cn("group/message flex w-full max-w-[90%] flex-col gap-2", from === "user" && "ml-auto items-end", className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-clip text-body text-ink [overflow-clip-margin:3px]",
        "group-data-[role=user]/message:rounded-2xl group-data-[role=user]/message:bg-active group-data-[role=user]/message:px-4 group-data-[role=user]/message:py-2.5",
        className,
      )}
      {...props}
    />
  );
}

export function MessageActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-0.5 text-muted", className)} {...props} />;
}

type MessageActionProps = ComponentProps<typeof Button> & { tooltip: string };

export function MessageAction({ tooltip, children, variant = "ghost", size = "icon-sm", ...props }: MessageActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={tooltip} size={size} variant={variant} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

const plugins = { code };

export const MessageResponse = memo(
  function MessageResponse({ className, ...props }: ComponentProps<typeof Streamdown>) {
    return <Streamdown className={cn("prose-chat size-full [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} plugins={plugins} {...props} />;
  },
  (previous, next) => previous.children === next.children && previous.isAnimating === next.isAnimating,
);
