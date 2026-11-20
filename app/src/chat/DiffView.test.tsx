import { afterEach, expect, test } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { DiffView } from "./DiffView";

afterEach(cleanup);

test("a file that ends in a newline shows no extra empty line", async () => {
  const { container } = render(<DiffView path="a.txt" before={"one\n"} after={"one\ntwo\n"} />);
  const lines = () => Array.from(container.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-content] [data-line-type]") ?? []);
  await waitFor(() => expect(lines().length).toBeGreaterThan(0));
  expect(lines().map((line) => line.textContent)).toEqual(["one", "two"]);
});
