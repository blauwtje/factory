# Plan: clamp

clamp(value, min, max) returns min when value is below min, max when value is above max and value otherwise. Callers pass min <= max.
Proof: node --test test/clamp.test.mjs
