---
name: build
description: "Builds a change with a proof for each step and one review of the result. Use when the user asks to build, implement, add or change behavior ('add X', 'implement this', 'make Y do Z'), or to run or resume a plan ('run the plan'). Not for a typo or one-line edit, writing a plan, or a bug whose cause is unknown."
argument-hint: "[plan path]"
---

# Build

Build lands a plan one task at a time. A task lands when its proof passes after the change and the plan's Land gate passes; `land-task.mjs` checks both and commits. It runs the proof on the code before the change too and refuses the task when it passes there. A task that changes structure but not behaviour proves itself by the same command giving the same output at the base and at the head; a type check or lint alone shows nothing about behaviour.

## The loop

A plan path runs this loop. With no path and no decided change, run step 2's script with `--plan` on each file in `docs/specs/`; when exactly one prints a `Next:` task, use that plan and say so, and ask for the path when several or none do.

1. **Settle the workspace.** A branch or worktree the request names is the answer; otherwise build on the current branch; on `main`, create a branch named after the plan topic and say so, without asking. Invoking build authorizes commits there; nothing is pushed.
2. **Ask the branch what landed.** Run `node "${CLAUDE_SKILL_DIR}/scripts/next-task.mjs" --plan <path> --root <checkout>`. It prints the landed tasks, then the next task with its text and the plan's Decisions, Non-goals and Assumptions. Only a `Plan-task:` commit shows what landed, so on a restart rerun it. `Next: none` goes to the end of the run.
3. **Build one task.** Send the task of the `Next:` line to a fresh `factory:builder` in the background, with the plan path, the task number, the checkout and `run-task-prompt.md` by path, and wait for its completion notification. The builder edits, then runs `land-task.mjs`, which proves red then green, runs the Land gate and commits.
4. **Route the return.** `GREEN` goes back to step 2.
   - `BLOCKED <n> NEEDS ANSWER: <question>`: ask the user, then re-dispatch that task with the answer in its prompt.
   - `PLAN DRIFT`: stop and hand the plan back to `factory:spec` with the builder's reason.
   - A build that fails once goes back to a fresh `factory:builder` with the first builder's report path, `.factory/implementer-<n>.md`, in its prompt, on the second-attempt row of the table below.
   - `BLOCKED proof <command> did not fail first`: `land-task` refused the task: its proof passes without the change. Send a fresh `factory:builder` to tighten that test, or hand the plan to `factory:spec` for a `Red: none (<reason>)`, and name the task in the final report.
   - A build that fails twice, or a repair that must change a module outside the task's `Files:`: stop, report both and hand it to `factory:diagnose`.
   - A repair names the rule the code broke and fixes the hits the finding names; one guard that fails on a new instance, at most one new test per cause.
   - Read `references/agent-cases.md` for a `Deferred:` proof or a missing `Proof:`.
5. **Stay thin.** This session writes at most 2 product files in a run; send anything larger to a builder, one per independent part. Run no check of your own after a landing. Only a block, a failure or a question speaks.

## Models

| Job | Who | Model, effort |
|---|---|---|
| Build a task | `factory:builder` | Sonnet, medium |
| Second attempt after a failure | `factory:builder` with the Agent tool's `model: opus` and `effort: high` | Opus, high |
| A design choice the plan leaves open | this session | its own model, high |
| Research | `factory:researcher` | Sonnet, medium |

## End of the run

1. Review the branch diff first, so the last code written is the code checked: run `factory:review` with the branch and the plan path. Read its last line: `Review: BLOCKED <reason>` makes the branch not ready and the report names the reason; `Review: CLEAN` and `Review: FINDINGS <n> fixed, <m> dropped` go on to step 2; the lead counts the fixed and dropped findings from the fix round, not the reviewer.
2. Run the plan's `Success criterion` command once, in the background, to a log, and read only the failing lines. Then run the plan's `Land gate:` command once the same way unless it is `none`: `land-task.mjs` skips a gate whose last pass took 60 s or more, so this is the one run of a slow gate. A failure goes to one builder fix and one rerun; a second failure ends with what still fails. When the repository's `package.json` has `bin` or `scripts.start` and the Success criterion ran neither the app nor gave `Product run: none (<reason>)`, report the branch as not ready; do not drive the app window.
3. Build the report from `git diff --stat <base>..HEAD` and the `Plan-task:` commits, not from the builders' summaries. Copy the `Tasks:` line from `next-task.mjs` into the report and list each of its `Stub:` and `Untouched:` lines as a finding for the user; an `Untouched:` line names a `Files:` path its landed task never changed, which the report names and never refuses. Say in plain words whether the branch is ready, the findings and what the user does next, and label each claim measured, inferred or guess. Keep `Proof:` lines and `## Manual checks` out of the message; the task reports in `.factory/` hold them.

## No plan

A decided change with no plan file runs these steps, so a small change gets the same proof.

1. **Orient.** Read only the ranges the request names. Otherwise dispatch `factory:researcher` with `Sources: repo` and read only its `Read next` ranges. Upstream decisions are settled.
2. **Decide the route.** An open product decision goes to `factory:spec` first. Count these facts: over two source, test or config files change, a dependency is added, a public signature changes, a persisted format or security boundary is crossed. With none, read `references/code-rules.md`, which every builder reads too then edit directly, run the check and commit it as in the end of the run, so the edit does not sit uncommitted. A test-first request continues at any count.
3. **Workspace.** Settle where the change commits, as in step 1 above. For a multi-file change, confirm a clean working tree or name its changed paths.
4. **Build.** Over 2 files, send each independent part to `factory:builder` in dependency order; otherwise read the same code rules and edit in dependency order.
5. **Prove.** Done needs a `Proof: <command> -> <output>` line from a real call on input this session did not write; otherwise write `Unverified: <reason>`. A test runner is no proof unless `package.json` names no `bin` and no `scripts.start`. For a test-first bug, commit the failing test alone, because a test committed with its fix does not show it failed. Run runners unpiped, so the failing command shows.
6. **Review and commit.** Run `factory:review` as in the end of the run, commit where step 3 placed it, leaving out paths that were already changed.

When the goal command is red, change the project until the command as typed is green without destroying anything; ask the user only about a destructive step.
