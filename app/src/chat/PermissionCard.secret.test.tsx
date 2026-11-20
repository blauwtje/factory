import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PermissionCard } from "./PermissionCard";

afterEach(cleanup);

const read = (file_path: string) => ({ kind: "permission" as const, request_id: "r1", tool_name: "Read", input: { file_path } });
const bash = (command: string) => ({ kind: "permission" as const, request_id: "r1", tool_name: "Bash", input: { command } });

test("a card for a .env file shows the secret warning", () => {
  render(<PermissionCard item={read("/work/app/.env")} onAnswer={() => {}} />);
  expect(screen.getByText("Touches a .env file, which may hold secrets")).toBeTruthy();
});

test("a card for a .env file has no Always allow button", () => {
  render(<PermissionCard item={read("/work/app/.env")} onAnswer={() => {}} />);
  expect(screen.queryByRole("button", { name: /Always allow/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Allow once/ })).toBeTruthy();
});

test("Shift+Enter on a .env card answers nothing", () => {
  const onAnswer = vi.fn();
  render(<PermissionCard item={read("/work/app/.env")} onAnswer={onAnswer} />);
  fireEvent.keyDown(screen.getByRole("region", { name: "Permission Read" }), { key: "Enter", shiftKey: true });
  expect(onAnswer).not.toHaveBeenCalled();
});

test("Enter on a .env card still allows once", () => {
  const onAnswer = vi.fn();
  render(<PermissionCard item={read("/work/app/.env")} onAnswer={onAnswer} />);
  fireEvent.keyDown(screen.getByRole("region", { name: "Permission Read" }), { key: "Enter" });
  expect(onAnswer).toHaveBeenCalledWith("AllowOnce", "Allowed once");
});

test("a Bash command that cats a secret path hides Always allow", () => {
  render(<PermissionCard item={bash("cat ~/.ssh/id_rsa")} onAnswer={() => {}} />);
  expect(screen.getByText("Touches SSH keys")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Always allow/ })).toBeNull();
});

test("a harmless file keeps Always allow", () => {
  const onAnswer = vi.fn();
  render(<PermissionCard item={read("/work/app/src/main.ts")} onAnswer={onAnswer} />);
  fireEvent.click(screen.getByRole("button", { name: /Always allow/ }));
  expect(onAnswer).toHaveBeenCalledWith("AllowAlways", "Always allowed");
});
