import { describe, expect, it } from "vitest";
import { planDiff, stepTitle } from "./planDiff";

describe("stepTitle", () => {
  it("cuts a bold title before the colon", () => {
    expect(stepTitle("**Add the route**: wire it in")).toBe("Add the route");
  });

  it("cuts at the earliest separator", () => {
    expect(stepTitle("Parse input — then `validate` - later: done")).toBe("Parse input");
  });

  it("uses the whole text without a separator", () => {
    expect(stepTitle("  Write the tests  ")).toBe("Write the tests");
  });
});

describe("planDiff", () => {
  it("marks new and changed steps and lists removed ones", () => {
    const previous = ["**Setup**: install deps", "**Build**: compile", "**Ship**: publish"];
    const current = ["**Setup**: install deps", "**Build**: compile with cache", "**Docs**: write them"];
    expect(planDiff(previous, current)).toEqual({
      marks: [undefined, "changed", "new"],
      removed: ["**Ship**: publish"],
    });
  });

  it("matches titles case-insensitively", () => {
    expect(planDiff(["Setup: a"], ["setup: a"])).toEqual({ marks: ["changed"], removed: [] });
  });

  it("pairs duplicate titles in order of appearance", () => {
    const previous = ["Test: one", "Test: two"];
    const current = ["Test: one", "Test: two", "Test: three"];
    expect(planDiff(previous, current)).toEqual({ marks: [undefined, undefined, "new"], removed: [] });
  });

  it("reports an unpaired duplicate as removed", () => {
    expect(planDiff(["Test: one", "Test: two"], ["Test: one"])).toEqual({
      marks: [undefined],
      removed: ["Test: two"],
    });
  });

  it("marks a reworded step without a title separator as changed at the same position", () => {
    const previous = ["Add `divide` to math.js and throw an `Error` on zero", "Write tests"];
    const current = ["Add `divide` to math.js and return `Infinity` on zero", "Write tests"];
    expect(planDiff(previous, current)).toEqual({ marks: ["changed", undefined], removed: [] });
  });
});
