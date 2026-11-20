import process from "node:process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (argv.includes("--version")) {
  process.stdout.write("2.1.326 (Claude Code)\n");
  process.exit(0);
}

const sessionId = flag("--session-id") ?? flag("--resume");
emit({ type: "system", subtype: "init", session_id: sessionId, model: flag("--model"), apiKeySource: "none" });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "") return;
  const message = JSON.parse(line);
  if (message.type === "control_response") {
    const { request_id, response } = message.response;
    emit({ type: "assistant", message: { content: [{ type: "text", text: `answered ${request_id} ${response.behavior}` }] } });
    return;
  }
  const text = message.message.content;
  const [verb, id, ...command] = text.split(" ");
  if (verb !== "ask") return;
  emit({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: command.join(" ") } } });
});
