import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { onAction, sendNotification } from "@tauri-apps/plugin-notification";
import { DONE_AFTER_MS, useNotices } from "./notices";
import type { ProjectSummary } from "./types";
import type { StreamEvent } from "@/chat/types";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
  onAction: vi.fn(async () => ({ unregister: vi.fn() })),
}));

const projects: ProjectSummary[] = [{ path: "~/code/app", name: "app", sessions: [{ id: "j1", title: "What agents do", status: "building" }] }];

let focused = false;
let now = 1_000_000;
const open = vi.fn();

function Harness() {
  useNotices(projects, open);
  return null;
}

const send = (event: StreamEvent, job_id = "j1") =>
  act(async () => {
    await emit("agent-event", { job_id, agent_id: "a1", event });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const result = (outcome: "Finished" | "Failed" | "Stopped"): StreamEvent => ({ Result: { session_id: "s", outcome } });
const text: StreamEvent = { TextDelta: { text: "hi" } };

beforeEach(async () => {
  focused = false;
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.mocked(sendNotification).mockClear();
  open.mockClear();
  mockWindows("main");
  mockIPC((cmd) => (cmd === "plugin:window|is_focused" ? focused : undefined), { shouldMockEvents: true });
  render(<Harness />);
  await act(async () => {});
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  clearMocks();
  vi.restoreAllMocks();
});

test("a permission request while unfocused notifies with the session title", async () => {
  await send({ ControlRequest: { request_id: "r", tool_name: "Bash", input: {} } });
  expect(sendNotification).toHaveBeenCalledWith({ title: "What agents do", body: "Needs permission for Bash", extra: { job_id: "j1" } });
});

test("the job id is the title when the session is unknown", async () => {
  await send(result("Failed"), "j9");
  expect(sendNotification).toHaveBeenCalledWith({ title: "j9", body: "Turn failed", extra: { job_id: "j9" } });
});

test("a focused window gets no notification", async () => {
  focused = true;
  await send(result("Failed"));
  expect(sendNotification).not.toHaveBeenCalled();
});

test("a short turn finishing sends nothing", async () => {
  await send(text);
  now += DONE_AFTER_MS - 1;
  await send(result("Finished"));
  expect(sendNotification).not.toHaveBeenCalled();
});

test("a turn of at least the threshold sends Finished", async () => {
  await send(text);
  now += DONE_AFTER_MS;
  await send(result("Finished"));
  expect(sendNotification).toHaveBeenCalledWith({ title: "What agents do", body: "Finished", extra: { job_id: "j1" } });
});

test("a stopped turn sends nothing", async () => {
  await send(text);
  now += DONE_AFTER_MS * 2;
  await send(result("Stopped"));
  expect(sendNotification).not.toHaveBeenCalled();
});

test("a tap opens the session of the notification", async () => {
  const listener = vi.mocked(onAction).mock.calls[0][0];
  listener({ actionId: "tap", notification: { extra: { job_id: "j1" } } } as never);
  expect(open).toHaveBeenCalledWith("j1");
  listener({ actionId: "other", notification: { extra: { job_id: "j2" } } } as never);
  expect(open).toHaveBeenCalledTimes(1);
});
