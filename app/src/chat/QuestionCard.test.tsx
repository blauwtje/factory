import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionCard, SKIP_REASON, questionsOf } from "./QuestionCard";

afterEach(cleanup);

const input = {
  questions: [
    { question: "Which port?", header: "Port", multiSelect: false, options: [{ label: "3000", description: "The default" }, { label: "8080" }] },
    { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "Lint" }, { label: "Tests" }] },
  ],
};
const item = { kind: "permission" as const, request_id: "q1", tool_name: "AskUserQuestion", input };
const card = (onAnswer = vi.fn()) => {
  render(<QuestionCard item={item} questions={questionsOf(input)!} onAnswer={onAnswer} />);
  return onAnswer;
};

test("sends every answer keyed by its question, with several picks joined", () => {
  const onAnswer = card();
  const send = screen.getByRole("button", { name: /Send answer/ });
  expect(send.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /8080/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Lint/ }));
  fireEvent.change(screen.getByLabelText("Other answer to Which checks?"), { target: { value: "Types" } });
  fireEvent.click(send);
  expect(onAnswer).toHaveBeenCalledWith({ Answer: { answers: { "Which port?": "8080", "Which checks?": "Lint, Types" } } }, "Answered");
});

test("number keys pick for the first open question and Enter sends", () => {
  const onAnswer = card();
  const region = screen.getByRole("region", { name: "Question from the agent" });
  fireEvent.keyDown(region, { key: "1" });
  fireEvent.keyDown(region, { key: "2" });
  fireEvent.keyDown(region, { key: "Enter" });
  expect(onAnswer).toHaveBeenCalledWith({ Answer: { answers: { "Which port?": "3000", "Which checks?": "Tests" } } }, "Answered");
});

test("Skip denies with a reason the agent can read", () => {
  const onAnswer = card();
  fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
  expect(onAnswer).toHaveBeenCalledWith({ Deny: { reason: SKIP_REASON } }, "Denied");
});

test("input without questions is not a question", () => {
  expect(questionsOf({ command: "ls" })).toBeUndefined();
});

test("Esc skips from the Something else field too", () => {
  const onAnswer = card();
  fireEvent.keyDown(screen.getByLabelText("Other answer to Which port?"), { key: "Escape" });
  expect(onAnswer).toHaveBeenCalledWith({ Deny: { reason: SKIP_REASON } }, "Denied");
});

test("an open question takes the focus so its keys work at once", () => {
  card();
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "Question from the agent" }));
});
