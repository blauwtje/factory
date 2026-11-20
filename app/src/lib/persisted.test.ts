import { afterEach, expect, test } from "vitest";
import { readPersisted, writePersisted } from "./persisted";

afterEach(() => localStorage.clear());

test("a written value reads back under the factory prefix", () => {
  writePersisted("stats:all", { sessions: 3 });
  expect(readPersisted("stats:all")).toEqual({ sessions: 3 });
  expect(JSON.parse(localStorage.getItem("factory:stats:all")!)).toEqual({ v: 1, value: { sessions: 3 } });
});

test("a missing key reads as null", () => {
  expect(readPersisted("stats:~/code/app")).toBeNull();
});

test("a value that does not parse reads as null", () => {
  localStorage.setItem("factory:stats:all", "{not json");
  expect(readPersisted("stats:all")).toBeNull();
});

test("a value stored under another version reads as null", () => {
  localStorage.setItem("factory:stats:all", JSON.stringify({ v: 2, value: { sessions: 3 } }));
  expect(readPersisted("stats:all")).toBeNull();
});

test("a value of null reads as null", () => {
  writePersisted("stats:all", null);
  expect(readPersisted("stats:all")).toBeNull();
});
