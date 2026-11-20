import { expect, test } from "vitest";
import { dayPart } from "./greeting";

const tuesday = (hour: number, day = 17) => new Date(2026, 10, day, hour);

test("the line names the weekday and the part of the day", () => {
  expect(dayPart(tuesday(9))).toBe("Tuesday morning");
  expect(dayPart(tuesday(14))).toBe("Tuesday afternoon");
  expect(dayPart(tuesday(21))).toBe("Tuesday evening");
  expect(dayPart(tuesday(11, 21))).toBe("Saturday morning");
});

test("after midnight the line says late at night instead of the next day", () => {
  expect(dayPart(tuesday(2))).toBe("Late at night");
});
