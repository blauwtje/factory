import { displayName } from './names.mjs';

export function greet(name) {
  return `Hello, ${displayName(name)}!`;
}
