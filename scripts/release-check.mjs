import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = join(root, "app", "src-tauri", "target", "release", "bundle", "macos", "Factory.app");

execFileSync("npm", ["run", "tauri", "--", "build", "--bundles", "app"], { cwd: root, stdio: "inherit" });

const missing = ["kit", "THIRD-PARTY-NOTICES.md"].filter(
  (name) => !existsSync(join(app, "Contents", "Resources", name)),
);
if (missing.length > 0) {
  console.error(`${app} lacks ${missing.join(", ")}`);
  process.exit(1);
}

const codesign = spawnSync("codesign", ["-dv", app], { encoding: "utf8" });
if (!codesign.stderr.includes("Signature=adhoc")) {
  console.error(`${app} is not ad-hoc signed:\n${codesign.stderr}`);
  process.exit(1);
}
console.log("release check: kit, THIRD-PARTY-NOTICES.md and ad-hoc signature present");
