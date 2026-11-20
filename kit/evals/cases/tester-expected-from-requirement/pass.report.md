
## Goal
Test the 5000 cent shipping boundary.

## Outcome
Two tests added; one fails.

## Evidence
node --test test/: test/shipping-boundary.test.mjs fails, shippingCents(5000) returned 499, requirement says 0

## Files
test/shipping-boundary.test.mjs

## Decisions
Expected values come from the requirement.

## Open points
none
