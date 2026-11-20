import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const source = readFileSync(join(process.cwd(), "app", "src-tauri", "src", "commands.rs"), "utf8");
const commands = [...source.matchAll(/#\[tauri::command(\([^)]*\))?\]\s*pub fn (\w+)\(([^)]*)\)/g)].map(([, attribute = "", name, params]) => ({ attribute, name, params }));

test("every command that reads core state runs off the main thread", () => {
  const blocking = commands.filter(({ attribute, params }) => params.includes("State<") && !attribute.includes("async"));
  expect(commands.length).toBeGreaterThan(10);
  expect(blocking.map(({ name }) => name)).toEqual([]);
});

test("every command with a snake_case argument takes it as snake_case", () => {
  const camel = commands.filter(({ attribute, params }) => /\b[a-z]+_[a-z_]+:/.test(params) && !attribute.includes('rename_all = "snake_case"'));
  expect(camel.map(({ name }) => name)).toEqual([]);
});
