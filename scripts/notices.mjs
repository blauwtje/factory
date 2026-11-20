import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cargoPackages, npmPackages } from "./licence-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cargoManifest = join(root, "app", "src-tauri", "Cargo.toml");
const registryLicences = join(root, "scripts", "registry-licences");

const REGISTRIES = [
  { name: "AI Elements", file: "ai-elements.txt", licence: "Apache-2.0", source: "https://github.com/vercel/ai-elements", into: "app/src/components/ai" },
  { name: "prompt-kit", file: "prompt-kit.txt", licence: "MIT", source: "https://github.com/ibelick/prompt-kit", into: "app/src/components/ai/loader.tsx" },
  { name: "motion-primitives", file: "motion-primitives.txt", licence: "MIT", source: "https://github.com/ibelick/motion-primitives", into: "app/src/components/motion" },
  { name: "Magic UI", file: "magicui.txt", licence: "MIT", source: "https://github.com/magicuidesign/magicui", into: "app/src/components/motion/border-beam.tsx" },
];

function productionNpmDirs() {
  const listing = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  return new Set(listing.split("\n").filter(Boolean));
}

function productionCargoNames() {
  const tree = execFileSync(
    "cargo",
    ["tree", "--manifest-path", cargoManifest, "--edges", "normal", "--target", "all", "--prefix", "none", "--format", "{p}"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return new Set(tree.split("\n").flatMap((line) => {
    const match = line.match(/^(\S+) v(\S+)/);
    return match ? [`${match[1]}@${match[2]}`] : [];
  }));
}

const LICENCE_FILE = /^(licen[cs]e|copying)/i;
const BUNDLED_LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

function licenceText(pkg) {
  const file = readdirSync(pkg.dir).find((name) => LICENCE_FILE.test(name));
  if (!file) return `The package ships no licence file; its manifest declares ${pkg.licence}.`;
  return readFileSync(join(pkg.dir, file), "utf8").trim();
}

function bundledLicences(pkg) {
  return readdirSync(pkg.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const file = readdirSync(join(pkg.dir, entry.name)).find((name) => BUNDLED_LICENCE_FILE.test(name));
      return file ? [`Bundled ${entry.name}:\n\n\`\`\`text\n${readFileSync(join(pkg.dir, entry.name, file), "utf8").trim()}\n\`\`\`\n`] : [];
    });
}

function section(pkg) {
  return [`## ${pkg.name}\n\nLicence: ${pkg.licence}\n\n\`\`\`text\n${licenceText(pkg)}\n\`\`\`\n`, ...bundledLicences(pkg)].join("\n");
}

function registrySection(registry) {
  const text = readFileSync(join(registryLicences, registry.file), "utf8").trim();
  return `## ${registry.name}\n\nSource: ${registry.source}\n\nAdapted into: ${registry.into}\n\nLicence: ${registry.licence}\n\n\`\`\`text\n${text}\n\`\`\`\n`;
}

function main() {
  const npmDirs = productionNpmDirs();
  const cargoNames = productionCargoNames();
  const packages = [
    ...npmPackages(join(root, "node_modules")).filter((pkg) => npmDirs.has(pkg.dir)),
    ...cargoPackages(cargoManifest).filter((pkg) => cargoNames.has(pkg.name) && pkg.name !== "factory@0.1.0"),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const copied = `# Copied source\n\nFactory contains components adapted from these registries.\n\n${REGISTRIES.map(registrySection).join("\n")}`;
  const text = `# Third-party notices\n\nFactory ships with these production dependencies.\n\n${packages.map(section).join("\n")}\n${copied}`;
  writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), text);
  console.log(`notices: ${packages.length} packages`);
}

main();
