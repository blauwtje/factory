const covers = (rule: string, path: string) => {
  const root = rule.replace(/\/+$/, "");
  return path === root || path.startsWith(`${root}/`);
};

export function folderAccountId(rules: Record<string, string>, path: string): string | null {
  const best = Object.keys(rules)
    .filter((rule) => covers(rule, path))
    .sort((a, b) => b.length - a.length)[0];
  return best === undefined ? null : rules[best];
}
