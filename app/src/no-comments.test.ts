import { join } from "node:path";
import { ESLint } from "eslint";
import { expect, test } from "vitest";

const root = process.cwd();
const sample = join(root, "app", "src", "sample.ts");
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, "app", "eslint.config.js") });

test("lint flags a comment and allows a global directive", async () => {
  const [commented] = await eslint.lintText("// explains\nexport const a = 1;\n", { filePath: sample });
  const [directive] = await eslint.lintText("/* global window */\nexport const a = 1;\n", { filePath: sample });
  expect(commented.messages.map((m) => m.ruleId)).toEqual(["local/no-comments"]);
  expect(directive.messages.map((m) => m.ruleId)).not.toContain("local/no-comments");
});
