import { describe, expect, it } from "vitest";
import guard from "../../../kit/hooks/guard-patterns.json";
import { dangerousCommandReason, secretPathReason } from "./dangerousCommand";

describe("secretPathReason", () => {
  it.each([
    [{ file_path: "/repo/.env" }],
    [{ file_path: "/repo/.env.local" }],
    [{ command: "cat .env" }],
    [{ file_path: "~/.ssh/id_ed25519" }],
    [{ command: "cat /home/u/.aws/credentials" }],
    [{ file_path: "/repo/.npmrc" }],
  ])("flags %j", (input) => {
    expect(secretPathReason(input)).toBeTruthy();
  });

  it.each([
    [{ file_path: "/repo/.envrc" }],
    [{ file_path: "/repo/src/environment.ts" }],
    [{ command: "npm test" }],
    [{ file_path: 3 }],
    [{}],
  ])("lets %j through", (input) => {
    expect(secretPathReason(input)).toBeUndefined();
  });

  it("returns the reason from the kit list", () => {
    expect(secretPathReason({ file_path: "/repo/.env" })).toBe(guard.paths[0].reason);
  });
});

describe("dangerousCommandReason", () => {
  it("returns the reason from the kit list", () => {
    expect(dangerousCommandReason("git reset --hard")).toBe(guard.commands[2].reason);
    expect(dangerousCommandReason("npm test")).toBeUndefined();
  });
});
