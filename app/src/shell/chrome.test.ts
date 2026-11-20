import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { TRAFFIC_LIGHTS } from "@/lib/platform";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const TRAFFIC_LIGHTS_WIDTH = 52;

test("the window places its traffic lights where the sidebar header expects them", () => {
  const config = JSON.parse(read("../../src-tauri/tauri.conf.json"));
  expect(config.app.windows[0].trafficLightPosition).toEqual({
    x: TRAFFIC_LIGHTS.x,
    y: TRAFFIC_LIGHTS.y,
  });
});

test("the sidebar header starts clear of the traffic lights", () => {
  expect(TRAFFIC_LIGHTS.inset).toBeGreaterThanOrEqual(
    TRAFFIC_LIGHTS.x + TRAFFIC_LIGHTS_WIDTH + 12,
  );
});

test("enabled clickable elements get a pointer cursor and disabled ones do not", () => {
  const css = read("../index.css");
  const rule = css.match(/([^{}]*)\{\s*cursor:\s*pointer;?\s*\}/);
  expect(rule?.[1]).toContain("button");
  expect(rule?.[1]).toContain('[role="tab"]');
  expect(rule?.[1]).toContain('[role="menuitem"]');
  expect(rule?.[1]).toContain("a[href]");
  expect(rule?.[1]).toMatch(/:not\([^)]*:disabled/);
});
