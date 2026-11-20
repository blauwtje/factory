import { expect, test, type Page } from "@playwright/test";

type Agent = { id: string; name: string; role: string; model: string; effort: string; why: string; status: string };
type Job = { id: string; title: string; status: string; project_path: string; project_name: string };
type Call = { cmd: string; args: Record<string, unknown> };

const api = `/@fs${process.cwd()}/node_modules/@tauri-apps/api`;

const SOLO: Agent[] = [
  { id: "solo-1", name: "solo", role: "solo-agent", model: "claude-opus-5-5", effort: "high", why: "works alone", status: "running" },
];

const TEAM: Agent[] = [
  { id: "orch-1", name: "orchestrator", role: "orchestrator", model: "claude-opus-5-5", effort: "high", why: "splits the work", status: "running" },
  { id: "design-1", name: "designer", role: "designer", model: "claude-opus-5-5", effort: "xhigh", why: "the design needs depth", status: "running" },
  { id: "build-1", name: "builder", role: "builder", model: "claude-sonnet-5-5", effort: "medium", why: "the build is routine", status: "running" },
];

const TRIGGERS: Record<string, string> = {
  orchestrator: "Opus 5.5 · High",
  designer: "Opus 5.5 · Extra high",
  builder: "Sonnet 5.5 · Medium",
};

async function openApp(page: Page, agentsFor: (jobId: string) => Agent[], seed: Job[] = []) {
  const calls: Call[] = [];
  const jobs: Job[] = [...seed];

  await page.exposeFunction("ipc", (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "list_jobs") return jobs;
    if (cmd === "list_agents") return agentsFor(String(args.job_id));
    if (cmd === "agent_history") return [];
    if (cmd === "create_job") {
      const { project_path, prompt } = (args as { job: { project_path: string; prompt: string } }).job;
      jobs.push({ id: "job-1", title: prompt, status: "building", project_path, project_name: "app" });
      return { id: "job-1", initialized: false };
    }
    if (cmd === "list_projects") return [{ path: "~/code/app", name: "app", last_used: 1 }];
    if (cmd === "merge_job") return { Merged: { commit: "abc1234" } };
    return null;
  });

  await page.route("**/mock-ipc.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        import { mockIPC, mockWindows } from "${api}/mocks.js";
        import { emit } from "${api}/event.js";
        window.emitEvent = emit;
        mockWindows("main");
        mockIPC((cmd, args) => window.ipc(cmd, args), { shouldMockEvents: true });
      `,
    }),
  );
  await page.route(/\/src\/main\.tsx/, async (route) => {
    const original = await (await route.fetch()).text();
    await route.fulfill({ contentType: "text/javascript", body: `import "/mock-ipc.js";\n${original}` });
  });

  await page.goto("/");
  return {
    calls,
    jobs,
    emit: (event: string, payload: unknown) =>
      page.evaluate(([name, data]) => (window as unknown as { emitEvent: (n: string, d: unknown) => Promise<void> }).emitEvent(name as string, data), [event, payload]),
  };
}

async function startSession(page: Page, prompt: string) {
  const composer = page.getByRole("textbox", { name: "What should we build?" });
  await composer.fill(prompt);
  await composer.press("Enter");
  await page.getByRole("button", { name: new RegExp(prompt) }).click();
}

test("Solo: from the composer to a merged job", async ({ page }) => {
  const app = await openApp(page, () => SOLO);
  await startSession(page, "Write a README");

  const created = app.calls.find((c) => c.cmd === "create_job")!;
  expect(created.args).toEqual({
    job: { project_path: "~/code/app", prompt: "Write a README" },
  });
  await expect(page.getByRole("button", { name: /Model/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);

  await app.emit("usage", {
    five_hour: { utilization: 0.42, resets_at: 1795222800 },
    seven_day: { utilization: 0.1, resets_at: 1795222800 },
  });
  await expect(page.getByText("5-hour limit")).toBeVisible();
  await expect(page.getByText("Weekly limit")).toBeVisible();

  await app.emit("agent-event", { agent_id: "solo-1", event: { TextDelta: { text: "Writing the README" } } });
  await expect(page.getByText("Writing the README")).toBeVisible();

  await page.getByRole("textbox", { name: "Message" }).fill("add a license section");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("add a license section")).toBeVisible();
  expect(app.calls.find((c) => c.cmd === "send_message")!.args).toEqual({
    agent_id: "solo-1",
    text: "add a license section",
  });

  app.jobs[0].status = "done";
  await app.emit("agent-event", { agent_id: "solo-1", event: { Result: { session_id: "s1", is_error: false } } });
  await page.getByRole("button", { name: "Merge" }).click();
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Merged abc1234")).toBeVisible();
  expect(app.calls.find((c) => c.cmd === "merge_job")!.args).toEqual({ job_id: "job-1" });
});

test("Team: each tab shows model, effort and why, and a team agent asks permission", async ({ page }) => {
  const app = await openApp(page, () => TEAM);
  await startSession(page, "Design and build search");

  await expect(page.getByRole("tab")).toHaveCount(3);
  for (const agent of TEAM) {
    await page.getByRole("tab", { name: new RegExp(agent.name) }).click();
    await expect(page.getByRole("button", { name: /Model/ })).toHaveText(TRIGGERS[agent.name]);
    await expect(page.getByText(agent.why)).toBeVisible();
  }

  await app.emit("agent-event", {
    agent_id: "orch-1",
    event: { ToolUse: { id: "t1", name: "mcp__factory__spawn_agent", input: { name: "builder" } } },
  });
  await expect(page.getByRole("status")).toHaveText("spawn_agent builder");

  await page.getByRole("tab", { name: /builder/ }).click();
  await app.emit("agent-event", { agent_id: "build-1", event: { TextDelta: { text: "Building the index" } } });
  await app.emit("agent-event", {
    agent_id: "build-1",
    event: { ControlRequest: { request_id: "r1", tool_name: "Bash", input: { command: "npm test" } } },
  });
  await page.getByRole("button", { name: "Allow once" }).click();
  expect(app.calls.find((c) => c.cmd === "answer_permission")!.args).toEqual({
    agent_id: "build-1",
    request_id: "r1",
    decision: "AllowOnce",
  });

  await page.getByRole("tab", { name: /designer/ }).click();
  await page.getByRole("tab", { name: /builder/ }).click();
  await expect(page.getByText("Building the index")).toBeVisible();

  app.jobs[0].status = "done";
  await app.emit("agent-event", { agent_id: "orch-1", event: { Result: { session_id: "s1", is_error: false } } });
  await page.getByRole("button", { name: "Merge" }).click();
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Merged abc1234")).toBeVisible();
});

test("A long chat scrolls back to its first message", async ({ page }) => {
  const app = await openApp(page, () => SOLO, [{ id: "job-1", title: "Explain the repo", status: "planning", project_path: "~/code/app", project_name: "app" }]);
  await page.getByRole("link", { name: /Explain the repo/ }).first().click();
  await expect(page.getByRole("button", { name: /Model/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  const long = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of the answer.`).join("\n\n");
  await app.emit("agent-event", { agent_id: "solo-1", event: { Assistant: { content: long } } });
  await app.emit("agent-event", { agent_id: "solo-1", event: { Result: { session_id: "s1", is_error: false } } });
  await expect(page.getByText("Line 80 of the answer.")).toBeVisible();

  await page.getByText("Line 80 of the answer.").hover();
  await page.mouse.wheel(0, -20000);
  await expect(page.getByText("Line 1 of the answer.", { exact: true })).toBeInViewport();
});
