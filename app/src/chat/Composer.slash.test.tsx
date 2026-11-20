import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CustomizeItem } from "@/ipc";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@/voice/DictateButton", () => ({ DictateButton: () => null }));

const mocks = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/ipc", async (original) => ({
  ...(await original<typeof import("@/ipc")>()),
  listCustomize: vi.fn(() => Promise.resolve({ project_path: "~/code/app", items: mocks.items, context_max: 0, measured: false })),
}));

const skill = (patch: Partial<CustomizeItem>) =>
  ({ id: patch.name, kind: "skill", description: "", source: "plugin", plugin: null, path: "", invocation: "", enabled: true, ...patch }) as CustomizeItem;

beforeEach(() => {
  mocks.items = [
    skill({ name: "build", description: "Build a plan task", plugin: "exo" }),
    skill({ name: "buried", description: "Off", plugin: "exo", enabled: false }),
    skill({ name: "review", description: "Review a diff" }),
  ];
});

afterEach(cleanup);

const typeInto = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });

test("/bu lists build with its plugin badge and Enter fills the name", async () => {
  const onSend = vi.fn();
  render(<Composer working={false} project="~/code/app" onSend={onSend} />);
  const box = screen.getByRole("combobox", { name: "Message" });
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  typeInto(box, "/bu");
  const option = await screen.findByRole("option", { name: /build/ });
  expect(option.textContent).toContain("exo");
  expect(screen.queryByRole("option", { name: /buried/ })).toBeNull();
  fireEvent.keyDown(box, { key: "Enter" });
  expect((box as HTMLTextAreaElement).value).toBe("/build ");
  expect(onSend).not.toHaveBeenCalled();
});

test("Escape closes the menu", async () => {
  render(<Composer working={false} onSend={vi.fn()} />);
  const box = screen.getByRole("combobox", { name: "Message" });
  typeInto(box, "/com");
  await screen.findByRole("option", { name: /compact/ });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryByRole("option")).toBeNull();
});

test("pasting a GitHub URL makes a chip and the prompt carries the full URL", () => {
  const onSend = vi.fn();
  render(<Composer working={false} onSend={onSend} />);
  const box = screen.getByRole("combobox", { name: "Message" });
  fireEvent.paste(box, { clipboardData: { files: [], getData: () => "github.com/acme/widgets/pull/42" } });
  expect(screen.getByText("acme/widgets#42")).toBeTruthy();
  typeInto(box, "check this");
  fireEvent.submit(box.closest("form")!);
  expect(onSend).toHaveBeenCalledWith("check this\nhttps://github.com/acme/widgets/pull/42");
});

test("Markdown renders a GitHub link as a chip that opens it", async () => {
  render(<Markdown>{"See https://github.com/acme/widgets/issues/7 now."}</Markdown>);
  const chip = await screen.findByRole("link", { name: "acme/widgets#7" });
  fireEvent.click(chip);
  expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/widgets/issues/7");
});

const everything = () => [
  skill({ name: "build", description: "Build a plan task", plugin: "exo" }),
  skill({ name: "ship", kind: "command", description: "Ship it" }),
  skill({ name: "reviewer", kind: "agent", description: "Reviews code", plugin: "exo" }),
  skill({ name: "github", kind: "mcp", description: "GitHub server" }),
];

test("/ alone lists all four groups and an agent fills @agent-name", async () => {
  mocks.items = everything();
  render(<Composer working={false} project="~/code/app" onSend={vi.fn()} />);
  const box = screen.getByRole("combobox", { name: "Message" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  typeInto(box, "/");
  await screen.findByRole("option", { name: /reviewer/ });
  for (const group of ["Skills", "Commands", "Agents", "Tools"]) expect(screen.getByRole("group", { name: group })).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("option", { name: /github/ }));
  expect((box as HTMLTextAreaElement).value).toBe("Use the github tools to ");
});

test("+ > Agents > an agent inserts @agent-name", async () => {
  mocks.items = everything();
  render(<Composer working={false} project="~/code/app" onSend={vi.fn()} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Agents" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /reviewer/ }));
  expect((screen.getByRole("combobox", { name: "Message" }) as HTMLTextAreaElement).value).toBe("@agent-reviewer ");
});
