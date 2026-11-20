import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PermissionCard } from "./PermissionCard";

afterEach(cleanup);

test("an answered permission card hides the request", () => {
  const item = { kind: "permission" as const, request_id: "r1", tool_name: "Edit", input: { file_path: "/tmp/app/main.ts" }, answer: "Allowed once" as const };
  render(<PermissionCard item={item} onAnswer={() => {}} />);
  expect(screen.getByText("Allowed once")).toBeTruthy();
  expect(screen.queryByText("/tmp/app/main.ts")).toBeNull();
});
