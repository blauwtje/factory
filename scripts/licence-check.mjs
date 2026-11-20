import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = ["MIT", "Apache-2.0", "ISC", "MPL-2.0", "Zlib", "Unicode-3.0", "BlueOak-1.0.0", "CC-BY-4.0", "0BSD", "Unlicense", "CDLA-Permissive-2.0"];
const FONT_ONLY = ["OFL-1.1"];
const FONT_SCOPES = ["@fontsource/", "@fontsource-variable/"];

const isFontPackage = (name) => FONT_SCOPES.some((scope) => name.startsWith(scope));

function isAllowedId(id, allowed) {
  const name = id.replace(/\+$/, "").replace(/\s+WITH\s+.+$/, "").toLowerCase();
  return allowed.some((entry) => entry.toLowerCase() === name) || name.startsWith("bsd-");
}

function evaluate(tokens, allowed) {
  const parseOr = () => {
    let result = parseAnd();
    while (tokens[0] === "OR") {
      tokens.shift();
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  const parseAnd = () => {
    let result = parseAtom();
    while (tokens[0] === "AND") {
      tokens.shift();
      const right = parseAtom();
      result = result && right;
    }
    return result;
  };
  const parseAtom = () => {
    const token = tokens.shift();
    if (token !== "(") return isAllowedId(token, allowed);
    const result = parseOr();
    tokens.shift();
    return result;
  };
  return parseOr();
}

export function isAllowedLicence(expression, allowed = ALLOWED) {
  if (!expression) return false;
  const spaced = expression.replaceAll("/", " OR ").replace(/([()])/g, " $1 ");
  const words = spaced.split(/\s+/).filter(Boolean);
  const tokens = words.reduce((acc, word) => {
    const joinsPrevious = word === "WITH" || acc.at(-1)?.endsWith(" WITH");
    if (joinsPrevious) acc[acc.length - 1] += ` ${word}`;
    else acc.push(word);
    return acc;
  }, []);
  return evaluate(tokens, allowed);
}

export function npmPackages(nodeModules) {
  return readdirSync(nodeModules, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith(".")) return [];
    const dir = join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) return npmPackages(dir);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const licence = typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
    return [{ name: `${manifest.name}@${manifest.version}`, licence, dir }];
  });
}

export function cargoPackages(manifestPath) {
  const metadata = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--manifest-path", manifestPath],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(metadata).packages.map((pkg) => ({
    name: `${pkg.name}@${pkg.version}`,
    licence: pkg.license,
    dir: dirname(pkg.manifest_path),
  }));
}

export function offenders(packages) {
  return packages.filter((pkg) => !isAllowedLicence(pkg.licence, isFontPackage(pkg.name) ? [...ALLOWED, ...FONT_ONLY] : ALLOWED));
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const packages = [
    ...npmPackages(join(root, "node_modules")),
    ...cargoPackages(join(root, "app", "src-tauri", "Cargo.toml")),
  ];
  const bad = offenders(packages);
  if (bad.length === 0) {
    console.log(`licence check: ${packages.length} packages, all allowed`);
    return;
  }
  for (const pkg of bad) console.error(`${pkg.name}: ${pkg.licence ?? "no licence"}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
