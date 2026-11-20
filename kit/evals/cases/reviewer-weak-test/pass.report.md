
## Goal
Review the average diff against the plan.

## Outcome
One finding.

## Evidence
node --test test/average.test.mjs: pass; both tests pass for any numeric result

## Files
test/average.test.mjs: both tests assert only typeof, so a wrong mean such as always 0 still passes; assert the values 2 and 0.

## Decisions
none

## Open points
none

Review: FINDINGS 1
