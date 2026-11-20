import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Markdown } from "./Markdown";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const clickLink = async (name: string | RegExp) => {
  const link = await screen.findByRole("link", { name });
  const prevented = !fireEvent.click(link);
  return prevented;
};

test("a markdown link opens in the browser and does not navigate", async () => {
  render(<Markdown>{"[docs](https://example.com/docs)"}</Markdown>);
  expect(await clickLink("docs")).toBe(true);
  expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
});

test("a bare https URL in text is a link", async () => {
  render(<Markdown>{"See https://example.com/a?b=1 for more."}</Markdown>);
  await clickLink("https://example.com/a?b=1");
  expect(openUrl).toHaveBeenCalledWith("https://example.com/a?b=1");
});

test("localhost with a port in text opens as http", async () => {
  render(<Markdown>{"The app runs on localhost:5173, open it."}</Markdown>);
  await clickLink("localhost:5173");
  expect(openUrl).toHaveBeenCalledWith("http://localhost:5173");
});

test("127.0.0.1 with a port in inline code opens as http", async () => {
  render(<Markdown>{"Try `127.0.0.1:8080/health` now."}</Markdown>);
  await clickLink("127.0.0.1:8080/health");
  expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:8080/health");
});

test("inline code that is not a URL stays plain", async () => {
  render(<Markdown>{"Run `npm test` first."}</Markdown>);
  await screen.findByText("npm test");
  expect(screen.queryByRole("link")).toBeNull();
});

test("a link with another scheme does not open", async () => {
  render(<Markdown>{"[run](/docs/page)"}</Markdown>);
  expect(await clickLink("run")).toBe(true);
  expect(openUrl).not.toHaveBeenCalled();
});
