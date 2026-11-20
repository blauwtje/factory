import type { Tokens } from "@/ipc";
import { formatTokens } from "./format";
import { EmptyChart, Panel } from "./Panel";

const SHOWN = 5;

type Row = { path: string; name: string; uncached: number };

const share = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? "Unknown";

function topProjects(projects: [string, Tokens][]): Row[] {
  const sorted = projects.map(([path, tokens]) => ({ path, name: nameOf(path), uncached: tokens.uncached })).sort((a, b) => b.uncached - a.uncached);
  const rest = sorted.slice(SHOWN);
  if (rest.length === 0) return sorted;
  const other = { path: "", name: `Other (${rest.length})`, uncached: rest.reduce((sum, { uncached }) => sum + uncached, 0) };
  return [...sorted.slice(0, SHOWN), other];
}

export function ProjectList({ projects }: { projects: [string, Tokens][] }) {
  const rows = topProjects(projects);
  const total = rows.reduce((sum, { uncached }) => sum + uncached, 0);

  return (
    <Panel title="Projects" aside="New tokens, all time">
      {total === 0 ? (
        <EmptyChart>No project usage yet</EmptyChart>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ path, name, uncached }) => (
            <li key={path || name} className="flex items-baseline gap-2 py-1">
              <span title={path || name} className="min-w-0 flex-1 truncate text-body text-ink">
                {name}
              </span>
              <span className="font-mono text-body font-medium tabular-nums text-ink">{formatTokens(uncached)}</span>
              <span className="min-w-8 text-right font-mono text-label tabular-nums text-faint">{share(uncached, total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
