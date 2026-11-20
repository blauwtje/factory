
## Goal
Add greetAll.

## Outcome
greetAll is added; the hyphen case still fails.

## Evidence
node --test: pass

## Files
src/greet.mjs

## Decisions
none

## Open points
displayName in src/names.mjs must capitalise each hyphen-separated part; it is not a listed file.
