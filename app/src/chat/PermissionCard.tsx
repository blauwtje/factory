import { Check, TriangleAlert, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CodeBlock } from "@/components/ai/code-block";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ApprovalState,
} from "@/components/ai/confirmation";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { dangerousCommandReason, secretPathReason } from "./dangerousCommand";
import { inputText, readableName } from "./tools";
import type { AnswerLabel, Decision, PermissionItem, PermissionRule } from "./types";

export const DENY_REASON = "Denied by the user";

type Choice = {
  keys: string[];
  hint: string;
  label: string;
  decision: (reason: string) => Decision;
  answer: AnswerLabel;
  variant: "default" | "outline" | "ghost";
};

const CHOICES: Choice[] = [
  { keys: ["Enter"], hint: "↵", label: "Allow once", decision: () => "AllowOnce", answer: "Allowed once", variant: "default" },
  { keys: ["Shift+Enter"], hint: "⇧↵", label: "Always allow", decision: () => "AllowAlways", answer: "Always allowed", variant: "outline" },
  { keys: ["Escape", "d", "D"], hint: "Esc", label: "Deny", decision: (reason) => ({ Deny: { reason: reason.trim() || DENY_REASON } }), answer: "Denied", variant: "ghost" },
];

const KBD_TONES: Record<Choice["variant"], string> = {
  default: "border-transparent bg-accent-ink/15 text-accent-ink",
  outline: "",
  ghost: "",
};

const BUTTON_TONES: Record<Choice["variant"], string> = {
  default: "",
  outline: "",
  ghost: "text-failed-ink hover:text-failed-ink",
};

function approval(answer: AnswerLabel | undefined): ApprovalState {
  if (!answer) return "requested";
  return answer === "Denied" ? "denied" : "approved";
}

function Request({ input }: { input: Record<string, unknown> }) {
  const command = inputText(input, "command");
  if (command) return <CodeBlock code={command} language="bash" className="bg-raised" />;
  const path = inputText(input, "file_path");
  if (path) return <p className="max-h-20 overflow-auto break-all rounded-md border border-edge bg-raised px-3 py-2 font-mono text-label text-ink">{path}</p>;
  return <CodeBlock code={JSON.stringify(input, null, 2)} language="json" className="bg-raised" />;
}

const ruleText = ({ toolName, ruleContent }: PermissionRule) => (ruleContent ? `${toolName}(${ruleContent})` : toolName);

const keyName = (event: KeyboardEvent) => (event.shiftKey && event.key === "Enter" ? "Shift+Enter" : event.key);

function choiceFor(event: KeyboardEvent, choices: Choice[]) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  return choices.find((choice) => choice.keys.includes(keyName(event)));
}

function Answered({ item, approved, instant }: { item: PermissionItem; approved: boolean; instant: boolean }) {
  const Icon = approved ? Check : X;
  return (
    <motion.p initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.press, ease: ease.out }} className="flex items-center gap-2 text-muted">
      <span className={cn("flex size-5 items-center justify-center rounded-full", approved ? "bg-done-soft text-done" : "bg-failed-soft text-failed")}>
        <Icon className="size-3" strokeWidth={3} aria-hidden />
      </span>
      {item.answer}
    </motion.p>
  );
}

export function PermissionCard({
  item,
  onAnswer,
}: {
  item: PermissionItem;
  onAnswer: (decision: Decision, answer: AnswerLabel) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const open = !item.answer;
  const [focused, setFocused] = useState(false);
  const [byKey, setByKey] = useState(false);
  const [reason, setReason] = useState("");
  const secret = secretPathReason(item.input);
  const warning = dangerousCommandReason(inputText(item.input, "command")) ?? secret;
  const choices = secret ? CHOICES.filter((choice) => choice.label !== "Always allow") : CHOICES;

  useEffect(() => {
    if (!open) return;
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.target !== ref.current) return;
      const choice = choiceFor(event, choices);
      if (!choice) return;
      event.preventDefault();
      setByKey(true);
      onAnswer(choice.decision(reason), choice.answer);
    }
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [open, onAnswer, reason, choices]);

  return (
    <Confirmation
      ref={ref}
      tabIndex={open ? 0 : undefined}
      onFocus={(event) => setFocused(event.target === event.currentTarget)}
      onBlur={() => setFocused(false)}
      state={approval(item.answer)}
      aria-label={`Permission ${item.tool_name}`}
      className="gap-3 p-4 ui-focus"
    >
      <ConfirmationTitle>
        <p className="font-medium">
          {open ? "Permission needed" : "Permission"} <span className="font-normal text-muted">to use {readableName(item.tool_name)}</span>
        </p>
      </ConfirmationTitle>
      <ConfirmationRequest>
        <Request input={item.input} />
      </ConfirmationRequest>
      {open && warning && (
        <p className="flex items-center gap-2 text-failed-ink">
          <TriangleAlert className="size-4 shrink-0 text-failed" aria-hidden />
          {warning}
        </p>
      )}
      <ConfirmationAccepted>
        <Answered item={item} approved instant={byKey} />
      </ConfirmationAccepted>
      <ConfirmationRejected>
        <Answered item={item} approved={false} instant={byKey} />
      </ConfirmationRejected>
      {open && (
        <Input
          aria-label="Reason for denying"
          placeholder="Reason for denying (optional)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
      <ConfirmationActions className="self-stretch justify-start gap-3">
        {choices.map((choice) => (
          <ConfirmationAction
            key={choice.label}
            variant={choice.variant}
            aria-keyshortcuts={choice.keys.join(" ")}
            className={BUTTON_TONES[choice.variant]}
            onClick={() => onAnswer(choice.decision(reason), choice.answer)}
          >
            {choice.label}
            <Kbd aria-hidden className={cn("transition-opacity duration-(--duration-press)", KBD_TONES[choice.variant], focused ? "opacity-100" : "opacity-60")}>
              {choice.hint}
            </Kbd>
          </ConfirmationAction>
        ))}
      </ConfirmationActions>
      {open && !secret && item.rules && item.rules.length > 0 && (
        <p className="text-muted">Always allow adds {item.rules.map(ruleText).join(", ")} to this session.</p>
      )}
    </Confirmation>
  );
}
