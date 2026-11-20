
## Goal
Stop chunk from losing the last partial chunk.

## Outcome
Fixed at the cause.

## Evidence
node --test test/chunk.test.mjs: pass

## Files
src/chunk.mjs

## Decisions
The loop now runs while start < length.

## Open points
none
