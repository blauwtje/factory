import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { ChangesPanel } from "./ChangesPanel";
import type { FileChange } from "@/ipc";

vi.mock("@/chat/DiffView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/DiffView")>()),
  DiffView: ({ path, after }: { path: string; after: string }) => <pre data-testid={`diff-${path}`}>{after}</pre>,
}));

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
});

const change = (over: Partial<FileChange>): FileChange => ({
  path: "a.txt",
  old_path: null,
  status: "Modified",
  binary: false,
  before: "",
  after: "",
  ...over,
});

function mockChanges(changes: FileChange[]) {
  mockIPC((cmd, args) => {
    if (cmd === "job_changes") return (args as { job_id: string }).job_id === "j1" ? changes : [];
  });
}

test("each changed file shows its path, status, line counts and diff", async () => {
  mockChanges([change({ path: "a.txt", before: "one\n", after: "one\ntwo\nthree\n" }), change({ path: "b.txt", status: "Added", after: "new" })]);
  render(<ChangesPanel jobId="j1" />);
  expect(await screen.findByText("a.txt")).toBeTruthy();
  expect(screen.getByText("b.txt")).toBeTruthy();
  expect(screen.getByText("Modified")).toBeTruthy();
  expect(screen.getByText("Added")).toBeTruthy();
  expect(screen.getByText("+2")).toBeTruthy();
  expect(screen.getByTestId("diff-b.txt").textContent).toBe("new");
});

test("a binary file shows a notice instead of a diff", async () => {
  mockChanges([change({ path: "logo.png", binary: true })]);
  render(<ChangesPanel jobId="j1" />);
  expect(await screen.findByText("Binary file, not shown")).toBeTruthy();
  expect(screen.queryByTestId("diff-logo.png")).toBeNull();
});

test("no changes shows an empty note", async () => {
  mockChanges([]);
  render(<ChangesPanel jobId="j1" />);
  expect(await screen.findByText("No changes yet.")).toBeTruthy();
});
