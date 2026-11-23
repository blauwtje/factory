import { expect, test } from "vitest";
import { cached, fetchCached } from "./cache";
import { writePersisted } from "./persisted";

test("a cached value survives a restart and one load serves every caller", async () => {
  writePersisted("modes", ["auto"]);
  expect(cached("modes")).toEqual(["auto"]);
  let calls = 0;
  const load = () => Promise.resolve(["plan", ++calls]);
  const [first, second] = await Promise.all([fetchCached("modes", load), fetchCached("modes", load)]);
  expect(first).toBe(second);
  expect(calls).toBe(1);
  expect(cached("modes")).toEqual(["plan", 1]);
});
