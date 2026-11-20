---
name: review
description: "Reviews a branch diff against its plan and keeps only the findings a failing test or repro proves. Use at the end of a build or a fix, or when the user asks to review a branch or diff. Not for a plan (spec) or a bug whose cause is unknown (diagnose)."
argument-hint: "<branch> [plan path]"
---

# Review

Review reads the diff once and keeps a finding only when someone reproduced it, because a finding nobody reproduced may be wrong.

## Steps

1. Read `git diff --stat <base>..<branch>` and then the diff. Check it against the plan's Decisions, Non-goals and Success criterion, and against `${CLAUDE_SKILL_DIR}/../build/references/code-rules.md`. Without a plan path, check against the code rules and the commit messages.
2. Write each finding as one line: `<path>:<line> <rule or decision broken> <what goes wrong>`. Report no preference or style point as a finding; list those apart as notes.
3. Send all findings in one message to one fresh `factory:builder`, briefed "write the failing test or repro for this finding; with no repro, drop it".
4. Fix only the reproduced findings, in one builder fix round that commits with the land command's `--fix <subject>`, one new test per cause at most.
5. Report the fixed findings, the dropped ones as unproven and the notes. With no reproduced finding, say the diff is clean.
6. The lead counts the findings fixed and dropped in steps 3 and 4, since the reviewer role only reports. End with exactly one line: `Review: CLEAN`, `Review: FINDINGS <n> fixed, <m> dropped` or `Review: BLOCKED <reason>`. BLOCKED means the diff, the plan or the tests could not be read or run.
