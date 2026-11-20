import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { CodeBlock } from "./ai/code-block";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from "./ai/confirmation";
import { Context, ContextTrigger } from "./ai/context";
import { Conversation, ConversationContent, ConversationEmptyState } from "./ai/conversation";
import { Loader } from "./ai/loader";
import { Message, MessageContent, MessageResponse } from "./ai/message";
import { ModelSelector, ModelSelectorTrigger } from "./ai/model-selector";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "./ai/plan";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "./ai/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai/reasoning";
import { Task, TaskContent, TaskItem, TaskTrigger } from "./ai/task";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "./ai/tool";
import { AnimatedBackground } from "./motion/animated-background";
import { TextShimmer } from "./motion/text-shimmer";
import { TransitionPanel } from "./motion/transition-panel";
import { TooltipProvider } from "./ui/tooltip";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cases: [string, ReactElement, string][] = [
  ["code-block", <CodeBlock code="const answer = 42;" language="ts" />, "const answer = 42;"],
  [
    "confirmation",
    <Confirmation state="requested">
      <ConfirmationTitle>Run npm install?</ConfirmationTitle>
      <ConfirmationRequest>Needs approval</ConfirmationRequest>
      <ConfirmationActions>
        <ConfirmationAction>Allow</ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>,
    "Allow",
  ],
  [
    "context",
    <Context usedTokens={50_000} maxTokens={200_000}>
      <ContextTrigger />
    </Context>,
    "25%",
  ],
  [
    "conversation",
    <Conversation>
      <ConversationContent>
        <ConversationEmptyState title="Nothing yet" />
      </ConversationContent>
    </Conversation>,
    "Nothing yet",
  ],
  ["loader", <Loader label="Working" />, "Working"],
  [
    "message",
    <Message from="assistant">
      <MessageContent>
        <MessageResponse>Hello there</MessageResponse>
      </MessageContent>
    </Message>,
    "Hello there",
  ],
  [
    "model-selector",
    <ModelSelector>
      <ModelSelectorTrigger>Sonnet</ModelSelectorTrigger>
    </ModelSelector>,
    "Sonnet",
  ],
  [
    "plan",
    <Plan defaultOpen>
      <PlanHeader>
        <PlanTitle>Ship the parser</PlanTitle>
      </PlanHeader>
      <PlanContent>Step one</PlanContent>
    </Plan>,
    "Ship the parser",
  ],
  [
    "prompt-input",
    <PromptInput onSubmit={() => {}}>
      <PromptInputTextarea placeholder="Ask factory" />
      <PromptInputFooter>
        <PromptInputSubmit />
      </PromptInputFooter>
    </PromptInput>,
    "Send",
  ],
  [
    "reasoning",
    <Reasoning defaultOpen>
      <ReasoningTrigger />
      <ReasoningContent>Weighing options</ReasoningContent>
    </Reasoning>,
    "Weighing options",
  ],
  [
    "task",
    <Task>
      <TaskTrigger title="Search files" />
      <TaskContent>
        <TaskItem>Read main.tsx</TaskItem>
      </TaskContent>
    </Task>,
    "Read main.tsx",
  ],
  [
    "tool",
    <Tool defaultOpen>
      <ToolHeader title="Bash" detail="npm test" state="running" />
      <ToolContent>
        <ToolOutput output="ok" />
      </ToolContent>
    </Tool>,
    "npm test",
  ],
  [
    "animated-background",
    <AnimatedBackground defaultValue="a">
      <button data-id="a">Alpha</button>
    </AnimatedBackground>,
    "Alpha",
  ],
  ["text-shimmer", <TextShimmer>Thinking</TextShimmer>, "Thinking"],
  ["transition-panel", <TransitionPanel activeIndex={1}>{[<p key="a">First</p>, <p key="b">Second</p>]}</TransitionPanel>, "Second"],
];

test.each(cases)("%s renders in isolation", (_name, element, text) => {
  render(<TooltipProvider>{element}</TooltipProvider>);
  expect([...screen.queryAllByText(text, { exact: false }), ...screen.queryAllByLabelText(text)]).not.toHaveLength(0);
});
