
## Goal
Stop chunk from losing the last partial chunk.

## Outcome
Fixed at the cause.

## Evidence
node --test test/chunk.test.mjs: failed before the fix on the new test, pass after

## Files
src/chunk.mjs; test/chunk.test.mjs

## Decisions
The loop stopped before a partial chunk; it now runs while start < length.

## Open points
none
