import { expect, test } from "vitest";
import { errorLine } from "./tools";

test("the error line skips a markdown heading and shows the message", () => {
  const item = { kind: "tool", id: "t1", name: "mcp__browser__browser_navigate", input: {}, started_at: 0, result: { output: "### Error\nError: net::ERR_HTTP_RESPONSE_CODE_FAILURE at http://localhost:5173/", is_error: true, finished_at: 1 } };
  expect(errorLine(item as Parameters<typeof errorLine>[0])).toBe("Error: net::ERR_HTTP_RESPONSE_CODE_FAILURE at http://localhost:5173/");
});
