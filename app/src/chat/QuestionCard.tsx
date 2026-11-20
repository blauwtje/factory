import { Check, MessageCircleQuestion, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationTitle,
} from "@/components/ai/confirmation";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AnswerLabel, Decision, PermissionItem } from "./types";

export const SKIP_REASON = "The user skipped the question";

type Option = { label: string; description?: string };

export type Question = { question: string; header?: string; options: Option[]; multiSelect?: boolean };

type Pick = { chosen: string[]; other: string };

const isOption = (value: unknown): value is Option => typeof value === "object" && value !== null && typeof (value as Option).label === "string";

const isQuestion = (value: unknown): value is Question =>
  typeof value === "object" && value !== null && typeof (value as Question).question === "string" && Array.isArray((value as Question).options) && (value as Question).options.every(isOption);

export function questionsOf(input: Record<string, unknown>): Question[] | undefined {
  const { questions } = input;
  return Array.isArray(questions) && questions.length > 0 && questions.every(isQuestion) ? questions : undefined;
}

function answerOf(question: Question, pick: Pick): string {
  const other = pick.other.trim();
  if (!question.multiSelect) return other || pick.chosen[0] || "";
  return [...pick.chosen, ...(other ? [other] : [])].join(", ");
}

const isTextField = (target: EventTarget | null) => target instanceof HTMLInputElement && target.type === "text";

function OptionRow({ option, index, multi, name, checked, onPick }: { option: Option; index: number; multi: boolean; name: string; checked: boolean; onPick: () => void }) {
  return (
    <label className="group/option flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 transition-colors duration-(--duration-press) hover:bg-raised has-checked:bg-raised has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-accent">
      <input type={multi ? "checkbox" : "radio"} name={name} checked={checked} onChange={onPick} className="sr-only" />
      <Kbd aria-hidden className="mt-0.5 shrink-0 group-has-checked/option:border-transparent group-has-checked/option:bg-accent group-has-checked/option:text-accent-ink">
        {index + 1}
      </Kbd>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-ink [overflow-wrap:anywhere]">{option.label}</span>
        {option.description && <span className="text-pretty text-muted">{option.description}</span>}
      </span>
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-text opacity-0 group-has-checked/option:opacity-100" />
    </label>
  );
}

function QuestionBlock({ question, index, pick, onChange }: { question: Question; index: number; pick: Pick; onChange: (pick: Pick) => void }) {
  const multi = Boolean(question.multiSelect);
  const toggle = (label: string) => {
    if (!multi) return onChange({ chosen: [label], other: "" });
    const chosen = pick.chosen.includes(label) ? pick.chosen.filter((item) => item !== label) : [...pick.chosen, label];
    onChange({ ...pick, chosen });
  };
  const type = (other: string) => onChange({ chosen: multi ? pick.chosen : [], other });
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex flex-col gap-1">
        {question.header && <span className="text-label font-medium text-approval-ink">{question.header}</span>}
        <span className="text-pretty font-medium text-ink">{question.question}</span>
        {multi && <span className="text-label text-muted">Pick one or more</span>}
      </legend>
      <div className="-mx-3 flex flex-col">
        {question.options.map((option, optionIndex) => (
          <OptionRow
            key={option.label}
            option={option}
            index={optionIndex}
            multi={multi}
            name={`question-${index}`}
            checked={pick.chosen.includes(option.label)}
            onPick={() => toggle(option.label)}
          />
        ))}
      </div>
      <Input type="text" aria-label={`Other answer to ${question.question}`} placeholder="Something else" value={pick.other} onChange={(event) => type(event.target.value)} />
    </fieldset>
  );
}

function Answered({ questions, answers, skipped, instant }: { questions: Question[]; answers: string[]; skipped: boolean; instant: boolean }) {
  const Icon = skipped ? X : Check;
  return (
    <motion.div initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.press, ease: ease.out }} className="flex flex-col gap-2">
      {!skipped &&
        questions.map((question, index) => (
          <p key={question.question} className="flex flex-col gap-0.5">
            <span className="text-muted">{question.question}</span>
            <span className="font-medium text-ink [overflow-wrap:anywhere]">{answers[index]}</span>
          </p>
        ))}
      <p className="flex items-center gap-2 text-muted">
        <span className={cn("flex size-5 items-center justify-center rounded-full", skipped ? "bg-failed-soft text-failed" : "bg-done-soft text-done")}>
          <Icon className="size-3" strokeWidth={3} aria-hidden />
        </span>
        {skipped ? "Skipped" : "Answered"}
      </p>
    </motion.div>
  );
}

export function QuestionCard({ item, questions, onAnswer }: { item: PermissionItem; questions: Question[]; onAnswer: (decision: Decision, answer: AnswerLabel) => void }) {
  const ref = useRef<HTMLElement>(null);
  const open = !item.answer;
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => ({ chosen: [], other: "" })));
  const [focused, setFocused] = useState(false);
  const [byKey, setByKey] = useState(false);
  const answers = questions.map((question, index) => answerOf(question, picks[index]));
  const complete = answers.every(Boolean);
  const active = Math.max(0, answers.findIndex((answer) => !answer));

  const submit = () => onAnswer({ Answer: { answers: Object.fromEntries(questions.map((question, index) => [question.question, answers[index]])) } }, "Answered");
  const skip = () => onAnswer({ Deny: { reason: SKIP_REASON } }, "Denied");
  const setPick = (index: number, pick: Pick) => setPicks((current) => current.map((old, at) => (at === index ? pick : old)));

  useEffect(() => {
    const draft = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value.trim() !== "";
    if (open && !draft) ref.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) return;
      const typing = isTextField(event.target);
      if (event.key === "Enter" && !event.shiftKey && complete && (typing || event.target === ref.current || event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        setByKey(true);
        submit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setByKey(true);
        skip();
        return;
      }
      if (typing) return;
      const option = questions[active].options[Number(event.key) - 1];
      if (!/^[1-9]$/.test(event.key) || !option) return;
      event.preventDefault();
      const pick = picks[active];
      const chosen = !questions[active].multiSelect ? [option.label] : pick.chosen.includes(option.label) ? pick.chosen.filter((label) => label !== option.label) : [...pick.chosen, option.label];
      setPick(active, { chosen, other: questions[active].multiSelect ? pick.other : "" });
    }
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  });

  return (
    <Confirmation
      ref={ref}
      tabIndex={open ? 0 : undefined}
      onFocus={() => setFocused(true)}
      onBlur={(event) => setFocused(ref.current?.contains(event.relatedTarget) ?? false)}
      state={!item.answer ? "requested" : item.answer === "Denied" ? "denied" : "approved"}
      aria-label="Question from the agent"
      className="gap-4 p-4 ui-focus"
    >
      <ConfirmationTitle icon={MessageCircleQuestion}>
        <p className="font-medium">{open ? (questions.length === 1 ? "The agent has a question" : `The agent has ${questions.length} questions`) : "Question"}</p>
      </ConfirmationTitle>
      {open && questions.map((question, index) => <QuestionBlock key={question.question} question={question} index={index} pick={picks[index]} onChange={(pick) => setPick(index, pick)} />)}
      <ConfirmationAccepted>
        <Answered questions={questions} answers={answers} skipped={false} instant={byKey} />
      </ConfirmationAccepted>
      <ConfirmationRejected>
        <Answered questions={questions} answers={answers} skipped instant={byKey} />
      </ConfirmationRejected>
      <ConfirmationActions className="self-stretch justify-start gap-3">
        <ConfirmationAction disabled={!complete} aria-keyshortcuts="Enter" onClick={submit}>
          Send answer
          <Kbd aria-hidden className={cn("border-transparent bg-accent-ink/15 text-accent-ink transition-opacity duration-(--duration-press)", focused ? "opacity-100" : "opacity-60")}>↵</Kbd>
        </ConfirmationAction>
        <ConfirmationAction variant="ghost" aria-keyshortcuts="Escape" className="text-muted" onClick={skip}>
          Skip
          <Kbd aria-hidden className={cn("transition-opacity duration-(--duration-press)", focused ? "opacity-100" : "opacity-60")}>Esc</Kbd>
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}
