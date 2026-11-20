import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ContextUsage } from "@/ipc";
import { formatTokens } from "@/stats/format";

type Item = { name: string; title?: string; meta: string; tokens?: number };
type Group = { name: string; items: Item[] };

const SOURCES: Record<string, string> = {
  userSettings: "User",
  projectSettings: "Project",
  localSettings: "Local",
  policySettings: "Managed",
  plugin: "Plugin",
  "built-in": "Built-in",
};

const sourceOf = (source?: string) => (source && SOURCES[source]) || source || "";
const fileName = (path: string) => path.split(/[\\/]/).slice(-2).join("/");
const isRule = (path: string) => /[\\/]rules[\\/]/.test(path);
const byTokens = (a: Item, b: Item) => (b.tokens ?? 0) - (a.tokens ?? 0);
const sum = (items: Item[]) => items.reduce((total, item) => total + (item.tokens ?? 0), 0);

function servers(usage: ContextUsage): Item[] {
  const found = new Map<string, { tokens: number; tools: number; loaded: boolean }>();
  for (const tool of usage.mcpTools ?? []) {
    const server = found.get(tool.serverName) ?? { tokens: 0, tools: 0, loaded: false };
    const loaded = tool.isLoaded !== false;
    found.set(tool.serverName, { tokens: server.tokens + (loaded ? tool.tokens : 0), tools: server.tools + 1, loaded: server.loaded || loaded });
  }
  return [...found].map(([name, server]) => ({ name, meta: `${server.tools} ${server.tools === 1 ? "tool" : "tools"}`, tokens: server.loaded ? server.tokens : undefined }));
}

function groupsOf(usage: ContextUsage): Group[] {
  const files = (usage.memoryFiles ?? []).map((file) => ({ name: fileName(file.path), title: file.path, meta: file.type, tokens: file.tokens }));
  return [
    { name: "Memory", items: files.filter((file) => !isRule(file.title)) },
    { name: "Rules", items: files.filter((file) => isRule(file.title)) },
    { name: "Skills", items: (usage.skills?.skillFrontmatter ?? []).map((skill) => ({ name: skill.name, title: skill.path, meta: sourceOf(skill.source), tokens: skill.tokens })) },
    { name: "Agents", items: (usage.agents ?? []).map((agent) => ({ name: agent.agentType, title: agent.path, meta: sourceOf(agent.source), tokens: agent.tokens })) },
    { name: "MCP", items: servers(usage) },
  ]
    .map((group) => ({ ...group, items: group.items.sort(byTokens) }))
    .filter((group) => group.items.length > 0);
}

function LoadedGroup({ group }: { group: Group }) {
  const total = sum(group.items);
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/trigger ui-press flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-1 text-label ui-focus-inset transition-colors duration-(--duration-press) hover:bg-active">
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint transition-[rotate] duration-(--duration-menu) ease-out group-data-[panel-open]/trigger:rotate-90" />
        <span className="font-medium text-ink">{group.name}</span>
        <span className="tabular-nums text-faint">{group.items.length}</span>
        <span className="ml-auto font-mono tabular-nums text-muted">{total > 0 ? formatTokens(total) : "Deferred"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col pb-1 pl-6">
          {group.items.map((item) => (
            <li key={`${item.meta}-${item.name}`} title={item.title} className="flex h-6 min-w-0 items-center gap-2 pr-1 text-label">
              <span className="min-w-0 truncate text-ink">{item.name}</span>
              <span className="shrink-0 text-caption text-faint">{item.meta}</span>
              <span className="ml-auto shrink-0 font-mono tabular-nums text-muted">{item.tokens === undefined ? "Deferred" : formatTokens(item.tokens)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ContextLoaded({ usage }: { usage: ContextUsage }) {
  const groups = groupsOf(usage);
  if (groups.length === 0) return null;
  return (
    <section aria-label="Loaded into the context" className="flex flex-col gap-0.5 border-t border-rule pt-3">
      <p className="mb-1 text-label font-medium text-ink">Loaded</p>
      {groups.map((group) => (
        <LoadedGroup key={group.name} group={group} />
      ))}
    </section>
  );
}
