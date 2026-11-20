import path from 'node:path';

const principles = path.join(import.meta.dirname, '..', 'rules', 'principles.md');
const additionalContext = `The conversation was compacted. Before the next step, read ${path.resolve(principles)} again and the plan or brief file your task names, because rules and decisions that lived only in the chat are gone.`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
