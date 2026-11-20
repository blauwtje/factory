import fs from 'node:fs';

const list = JSON.parse(fs.readFileSync(new URL('./guard-patterns.json', import.meta.url), 'utf8'));
const compile = (entries) => entries.map(({ pattern, reason }) => ({ pattern: new RegExp(pattern), reason }));
const COMMANDS = compile(list.commands);
const PATHS = compile(list.paths);

const firstReason = (patterns, text) =>
  typeof text === 'string' ? patterns.find(({ pattern }) => pattern.test(text))?.reason : undefined;

function reasonFor({ permission_mode: mode, tool_name: tool, tool_input: input = {} }) {
  if (mode === 'bypassPermissions') return undefined;
  if (tool === 'Bash') return firstReason(COMMANDS, input.command) ?? firstReason(PATHS, input.command);
  if (['Read', 'Edit', 'Write'].includes(tool)) return firstReason(PATHS, input.file_path);
  return undefined;
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const hook = parse(fs.readFileSync(0, 'utf8'));
const reason = hook && typeof hook === 'object' ? reasonFor(hook) : undefined;
if (reason) {
  const output = { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason };
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: output })}\n`);
}
