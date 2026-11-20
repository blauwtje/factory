import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ChangesPanel } from "./ChangesPanel";
import type { FileChange, Scope } from "@/ipc";

vi.mock("@/chat/DiffView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/DiffView")>()),
  DiffView: ({ path }: { path: string }) => <pre data-testid={`diff-${path}`} />,
}));

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const file = (path: string): FileChange => ({ path, old_path: null, status: "Modified", binary: false, before: "", after: "" });

const sha = "abcdef1234567890";

function mockScopes() {
  const requested: Scope[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "job_commits") return [{ sha, subject: "Add login" }];
    if (cmd !== "job_changes") return;
    const scope = (args as { scope: Scope }).scope;
    requested.push(scope);
    if (scope.kind === "uncommitted") return [file("wip.txt")];
    if (scope.kind === "commit") return [file("one.txt")];
    return [file("branch.txt")];
  });
  return requested;
}

test("the scope select starts on Branch and lists Uncommitted and each commit", async () => {
  mockScopes();
  render(<ChangesPanel jobId="j1" />);
  expect(await screen.findByTestId("diff-branch.txt")).toBeTruthy();
  const select = screen.getByLabelText("Scope") as HTMLSelectElement;
  expect(select.value).toBe("branch");
  expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Branch", "Uncommitted", "abcdef1 Add login"]);
});

test("choosing Uncommitted loads the uncommitted changes", async () => {
  const requested = mockScopes();
  render(<ChangesPanel jobId="j1" />);
  await screen.findByTestId("diff-branch.txt");
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "uncommitted" } });
  expect(await screen.findByTestId("diff-wip.txt")).toBeTruthy();
  expect(screen.queryByTestId("diff-branch.txt")).toBeNull();
  expect(requested.at(-1)).toEqual({ kind: "uncommitted" });
});

test("choosing a commit loads that commit's changes", async () => {
  const requested = mockScopes();
  render(<ChangesPanel jobId="j1" />);
  await screen.findByTestId("diff-branch.txt");
  await waitFor(() => expect((screen.getByLabelText("Scope") as HTMLSelectElement).options.length).toBe(3));
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: sha } });
  expect(await screen.findByTestId("diff-one.txt")).toBeTruthy();
  expect(requested.at(-1)).toEqual({ kind: "commit", sha });
});
