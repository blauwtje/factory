import process from "node:process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (argv.includes("--version")) {
  process.stdout.write("2.1.326 (Claude Code)\n");
  process.exit(0);
}

emit({ type: "system", subtype: "init", session_id: flag("--session-id"), model: flag("--model"), apiKeySource: "none" });

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "user" && message.message.content === "argv") {
    emit({ type: "assistant", message: { content: [{ type: "text", text: JSON.stringify(argv) }] } });
    return;
  }
  if (message.type === "user") {
    const suggestions = [
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls" }], behavior: "allow", destination: "localSettings" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
    emit({ type: "control_request", request_id: "req_1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" }, permission_suggestions: suggestions } });
    return;
  }
  emit({ type: "assistant", message: { content: [{ type: "text", text: line }] } });
});
