import { expect, test } from "vitest";
import { restartAction } from "./gate";

test("restarts only once the update is downloaded, no agent is busy and the window is focused", () => {
  expect(restartAction({ installed: false, idle: true, focused: true })).toBe("none");
  expect(restartAction({ installed: true, idle: false, focused: true })).toBe("wait");
  expect(restartAction({ installed: true, idle: true, focused: false })).toBe("wait");
  expect(restartAction({ installed: true, idle: true, focused: true })).toBe("restart");
});
