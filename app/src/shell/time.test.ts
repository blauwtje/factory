import { expect, test } from "vitest";
import { relativeTime } from "./time";

test("relative time counts minutes, hours and days, then shows the date after a week", () => {
  const now = 1_800_000_000;
  expect(relativeTime(now - 30, now)).toBe("now");
  expect(relativeTime(now - 5 * 60, now)).toBe("5m");
  expect(relativeTime(now - 3 * 3600, now)).toBe("3h");
  expect(relativeTime(now - 2 * 86400, now)).toBe("2d");
  expect(relativeTime(now - 10 * 86400, now)).toBe(
    new Date((now - 10 * 86400) * 1000).toLocaleDateString([], { month: "short", day: "numeric" }),
  );
});
