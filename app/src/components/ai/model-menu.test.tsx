import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModelMenu } from "./model-menu";

afterEach(cleanup);

const models = [
  { value: "opus", label: "Opus 5.5", hint: "Plans, reviews and debugs with care" },
  { value: "sonnet", label: "Sonnet 5.5", hint: "Fast everyday building and testing" },
];
const efforts = [
  { value: "high", label: "High", hint: "Thinks it through before acting" },
  { value: "max", label: "Max", hint: "Thinks longest, uses the most limits" },
];

test("the trigger reads model and effort and the picker changes each", async () => {
  const onChange = vi.fn();
  render(<ModelMenu model="opus" effort="high" models={models} efforts={efforts} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: /Model/ });
  expect(trigger.textContent).toContain("Opus 5.5 · High");

  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("radio", { name: "Sonnet 5.5" }));
  expect(onChange).toHaveBeenCalledWith({ model: "sonnet", effort: "high" });
  fireEvent.click(screen.getByRole("radio", { name: "Max" }));
  expect(onChange).toHaveBeenLastCalledWith({ model: "opus", effort: "max" });
});

test("the trigger name holds Model and the current choice", () => {
  render(<ModelMenu model="opus" effort="high" models={models} efforts={efforts} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Model.*Opus 5\.5 · High/ })).not.toBeNull();
});

test("each model shows its hint and the effort row shows the hint of the chosen step", async () => {
  const { rerender } = render(<ModelMenu model="opus" effort="high" models={models} efforts={efforts} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Model/ }));
  const opus = await screen.findByRole("radio", { name: "Opus 5.5" });
  expect(document.getElementById(opus.getAttribute("aria-describedby")!)?.textContent).toBe("Plans, reviews and debugs with care");
  expect(screen.getByText("Fast everyday building and testing")).not.toBeNull();
  expect(screen.getByRole("radiogroup", { name: "Effort" })).not.toBeNull();
  expect(screen.getByText("Thinks it through before acting")).not.toBeNull();

  rerender(<ModelMenu model="opus" effort="max" models={models} efforts={efforts} onChange={vi.fn()} />);
  expect(screen.getByRole("radio", { name: "Max" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Thinks longest, uses the most limits")).not.toBeNull();
  expect(screen.queryByText("Thinks it through before acting")).toBeNull();
});

test("an empty choice follows the marked default, which shows once and stores empty", async () => {
  const onChange = vi.fn();
  const marked = [{ ...efforts[0], isDefault: true }, efforts[1]];
  render(<ModelMenu model="opus" effort="" models={models} efforts={marked} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: /Model/ });
  expect(trigger.textContent).toContain("High");
  fireEvent.click(trigger);
  expect((await screen.findByRole("radio", { name: "High" })).getAttribute("aria-checked")).toBe("true");
  expect(screen.getAllByText("Default")).toHaveLength(1);
  fireEvent.click(screen.getByRole("radio", { name: "Max" }));
  expect(onChange).toHaveBeenLastCalledWith({ model: "opus", effort: "max" });
});
