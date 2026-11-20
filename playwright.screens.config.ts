import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT ?? 1440);

export default defineConfig({
  testDir: "e2e",
  testMatch: process.env.SPEC ?? "screens.spec.ts",
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: process.env.SCHEME === "light" ? "light" : "dark" },
  webServer: {
    command: `npx vite --config app/vite.config.ts --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
