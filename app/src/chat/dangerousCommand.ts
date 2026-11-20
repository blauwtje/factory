import guard from "../../../kit/hooks/guard-patterns.json";

type Rule = { pattern: string; reason: string };

const compile = (rules: Rule[]): [RegExp, string][] => rules.map(({ pattern, reason }) => [new RegExp(pattern), reason]);

const COMMANDS = compile(guard.commands);
const PATHS = compile(guard.paths);

export function dangerousCommandReason(command: string): string | undefined {
  return COMMANDS.find(([pattern]) => pattern.test(command))?.[1];
}

export function secretPathReason(input: Record<string, unknown>): string | undefined {
  const targets = [input.file_path, input.command].filter((value): value is string => typeof value === "string");
  return PATHS.find(([pattern]) => targets.some((target) => pattern.test(target)))?.[1];
}
