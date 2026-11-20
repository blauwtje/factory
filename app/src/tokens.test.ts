import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const css = ["index.css", "shell/shell.css"].map(read).join("\n");

const LIGHT = ":root, .scheme-light";
const DARK = ':root[data-theme="dark"], .scheme-dark';
const MODES = { light: LIGHT, dark: DARK };
const PALETTES = ["graphite", "moss", "tide", "oxide", "mono"] as const;
type Mode = keyof typeof MODES;
type Palette = (typeof PALETTES)[number];

function declarations(source: string) {
  const bySelector = new Map<string, Record<string, string>>();
  for (const [, head, body] of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = head.split(";").pop()!.trim().replace(/\s+/g, " ");
    const props = bySelector.get(selector) ?? {};
    for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) props[name] = value.trim();
    bySelector.set(selector, props);
  }
  return bySelector;
}

const blocks = declarations(css);

function theme(palette: Palette, mode: Mode) {
  const base = blocks.get(MODES[mode]) ?? {};
  const own = palette === "graphite" ? {} : (blocks.get(`[data-palette="${palette}"]:is(${MODES[mode]})`) ?? {});
  const tokens = { ...base, ...own };
  const read = (name: string): string => {
    let value = tokens[name];
    while (value?.startsWith("var(")) value = tokens[value.slice(6, -1)];
    if (value === undefined) throw new Error(`--${name} is missing in ${palette} ${mode}`);
    const relative = RELATIVE_OKLCH.exec(value);
    return relative ? fromOklch(read(relative[1]), Number(relative[2]), Number(relative[3] ?? 1)) : value;
  };
  return read;
}

const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const clamp = (channel: number) => Math.min(1, Math.max(0, channel));

function hexToLinear(hex: string) {
  const digits = hex.length === 4 ? [...hex.slice(1)].map((d) => d + d) : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return digits.map((pair) => linear(parseInt(pair, 16) / 255));
}

function oklchToLinear(l: number, c: number, h: number) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3);
  return [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map(clamp);
}

const RELATIVE_OKLCH = /^oklch\(from var\(--([\w-]+)\) ([\d.]+) (?:c|calc\(c \* ([\d.]+)\)) h\)$/;

function fromOklch(base: string, lightness: number, chromaScale: number) {
  const [l, m, s] = hexToLinear(base);
  const [lc, mc, sc] = [
    0.4122214708 * l + 0.5363325363 * m + 0.0514459929 * s,
    0.2119034982 * l + 0.6806995451 * m + 0.1073969566 * s,
    0.0883024619 * l + 0.2817188376 * m + 0.6299787005 * s,
  ].map(Math.cbrt);
  const a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc;
  const b = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${lightness} ${(Math.hypot(a, b) * chromaScale).toFixed(4)} ${hue.toFixed(2)})`;
}

function luminance(color: string) {
  const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(color);
  const rgb = /^#[\da-f]{3}([\da-f]{3})?$/i.test(color)
    ? hexToLinear(color)
    : oklch
      ? oklchToLinear(Number(oklch[1]) / (oklch[2] ? 100 : 1), Number(oklch[3]), Number(oklch[4]))
      : undefined;
  if (!rgb) throw new Error(`cannot read colour ${color}`);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const SCHEMES = PALETTES.flatMap((palette) => (Object.keys(MODES) as Mode[]).map((mode) => [palette, mode] as const));

describe.each(SCHEMES)("%s %s", (palette, mode) => {
  const token = theme(palette, mode);
  const lowest = (name: string) => Math.min(...["surface", "raised"].map((ground) => contrast(token(name), token(ground))));

  test.each(["ink", "muted", "faint", "accent-text"])("--%s text reads at 4.5:1 on surface and raised", (name) => {
    expect(lowest(name)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(["accent", "field-edge", "chart-1", "chart-input", "chart-cache-write", "chart-output", "chart-2", "chart-3", "chart-4", "chart-5", "chart-other"])("--%s stands out at 3:1 on surface and raised", (name) => {
    expect(lowest(name)).toBeGreaterThanOrEqual(3);
  });
});

test.each(PALETTES)("the dark rule in %s shows on raised panels", (palette) => {
  const token = theme(palette, "dark");
  expect(contrast(token("rule"), token("raised"))).toBeGreaterThanOrEqual(1.14);
});

test("no element draws its own translucent focus ring", () => {
  const files = readdirSync(__dirname, { recursive: true, encoding: "utf8" }).filter((file) => /\.(tsx?|css)$/.test(file) && !file.endsWith("tokens.test.ts"));
  const offenders = files.filter((file) => /ring-accent\/|focus:ring-accent/.test(read(file)));
  expect(offenders).toEqual([]);
});

test("reduced motion keeps only opacity and colour transitions", () => {
  const reduced = read("index.css").split("@media (prefers-reduced-motion: reduce)")[1];
  const properties = /transition-property:([^;!]+)!important;/.exec(reduced)?.[1].split(",").map((name) => name.trim()) ?? [];
  expect(properties).toContain("opacity");
  expect(properties.filter((name) => /transform|translate|scale|rotate|all/.test(name))).toEqual([]);
});
