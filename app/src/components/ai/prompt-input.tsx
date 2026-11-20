import { ArrowUp, Plus, Square, X } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Loader } from "./loader";

export type PromptStatus = "idle" | "submitted" | "streaming" | "error";

type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit: (text: string, event: FormEvent<HTMLFormElement>) => void;
};

export function PromptInput({ className, onSubmit, children, ...props }: PromptInputProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("message") ?? "");
    onSubmit(text, event);
  }
  return (
    <form
      className={cn(
        "relative flex w-full flex-col rounded-2xl bg-surface text-ink shadow-composer transition-shadow duration-(--duration-panel) ease-out",
        "focus-within:shadow-[0_0_0_1px_var(--faint),0_1px_3px_rgb(0_0_0/0.06)]",
        className,
      )}
      onSubmit={submit}
      {...props}
    >
      {children}
    </form>
  );
}

export function PromptInputBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("contents", className)} {...props} />;
}

export function PromptInputTextarea({ className, onKeyDown, placeholder = "Ask anything", ...props }: ComponentProps<"textarea">) {
  const [composing, setComposing] = useState(false);

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) return;
    if (composing || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const submit = event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <textarea
      name="message"
      rows={1}
      placeholder={placeholder}
      className={cn(
        "field-sizing-content max-h-60 min-h-14 w-full resize-none bg-transparent px-4 pt-4 pb-1 text-body text-ink outline-none placeholder:text-faint",
        className,
      )}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onKeyDown={keyDown}
      {...props}
    />
  );
}

export function insertAtCursor(textarea: HTMLTextAreaElement | null, text: string) {
  const start = textarea?.selectionStart;
  const end = textarea?.selectionEnd;
  return (value: string) => {
    const before = value.slice(0, start ?? value.length);
    const gap = before === "" || /\s$/.test(before) ? "" : " ";
    return before + gap + text + value.slice(end ?? value.length);
  };
}

export function PromptInputHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-1 px-3 pt-3", className)} {...props} />;
}

export function PromptInputFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between gap-1 px-2.5 pb-2.5 pt-1", className)} {...props} />;
}

export function PromptInputTools({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 items-center gap-0.5", className)} {...props} />;
}

type PromptInputButtonProps = ComponentProps<typeof Button> & { tooltip?: ReactNode };

export function PromptInputButton({ tooltip, variant = "ghost", size = "sm", className, ...props }: PromptInputButtonProps) {
  const button = <Button type="button" variant={variant} size={size} className={cn("text-muted hover:text-ink", className)} {...props} />;
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export const PromptInputActionMenu = DropdownMenu;

export function PromptInputActionMenuTrigger({ children, className, ...props }: Omit<ComponentProps<typeof DropdownMenuTrigger>, "className"> & { className?: string }) {
  return (
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Add" className={cn("text-muted hover:text-ink", className)} />} {...props}>
      {children ?? <Plus />}
    </DropdownMenuTrigger>
  );
}

export const PromptInputActionMenuContent = DropdownMenuContent;
export const PromptInputActionMenuItem = DropdownMenuItem;

const SUBMIT_ICONS: Record<PromptStatus, ReactNode> = {
  idle: <ArrowUp />,
  submitted: <Loader variant="circular" size="sm" />,
  streaming: <Square className="fill-current" />,
  error: <X />,
};

type PromptInputSubmitProps = ComponentProps<typeof Button> & { status?: PromptStatus; onStop?: () => void };

export function PromptInputSubmit({ status = "idle", onStop, onClick, className, children, ...props }: PromptInputSubmitProps) {
  const working = status === "submitted" || status === "streaming";
  const stops = working && onStop !== undefined;
  return (
    <Button
      aria-label={working ? "Stop" : "Send"}
      type={stops ? "button" : "submit"}
      size="icon-sm"
      className={cn("size-8 rounded-full disabled:bg-active disabled:text-faint disabled:opacity-100", className)}
      onClick={(event) => {
        if (stops) {
          event.preventDefault();
          onStop();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {children ?? SUBMIT_ICONS[status]}
    </Button>
  );
}

export { Select as PromptInputSelect } from "@/components/ui/select";

export function PromptInputSelectTrigger({ className, ...props }: Omit<ComponentProps<typeof SelectTrigger>, "className"> & { className?: string }) {
  return <SelectTrigger size="sm" className={cn("border-transparent bg-transparent text-muted shadow-none hover:border-transparent hover:bg-active/70 hover:text-ink data-[popup-open]:bg-active/70", className)} {...props} />;
}

export const PromptInputSelectContent = SelectContent;
export const PromptInputSelectItem = SelectItem;
export const PromptInputSelectValue = SelectValue;
