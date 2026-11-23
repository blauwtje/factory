import { Badge } from "@/components/ui/badge";
import type { Customize, CustomizeItem, CustomizeKind } from "@/ipc";
import { cn } from "@/lib/utils";
import { cardClass, Panel } from "@/settings/parts";
import { SECTIONS } from "@/shell/SettingsNav";
import { relativeTime } from "@/shell/time";
import type { SettingsSection } from "@/shell/types";
import { count, formatTokens } from "@/stats/format";
import { inContext, inSection, KIND_ORDER, KINDS, PAGE_KINDS, tokenText, VERDICT_LABELS } from "./kinds";

const TOP = 5;
const RANKED: CustomizeKind[] = ["skill", "command", "agent", "mcp"];

type Context = NonNullable<Customize["context"]>;
type Part = { name: string; tokens: number; color: string | undefined };

const CATEGORY_KINDS: Record<string, CustomizeKind> = { "Memory files": "memory", Skills: "skill", "Custom agents": "agent", "MCP tools": "mcp" };
const OTHER_COLORS = ["var(--chart-other)", "var(--chart-input)", "var(--chart-cache-write)", "var(--chart-2)"];

const loaded = (item: CustomizeItem) => item.loaded_tokens ?? 0;
const isExact = (items: CustomizeItem[]) => items.every((item) => item.exact || !item.loaded_tokens);
const sum = (items: CustomizeItem[], value: (item: CustomizeItem) => number) => items.reduce((total, item) => total + value(item), 0);

function measuredParts(context: Context): Part[] {
  const used = context.categories.filter((category) => category.kind === "used" && category.name !== "Messages" && category.tokens > 0);
  const others = used.filter((category) => !CATEGORY_KINDS[category.name]);
  return used.map((category) => {
    const kind = CATEGORY_KINDS[category.name];
    const color = kind ? KINDS[kind].color : OTHER_COLORS[others.indexOf(category) % OTHER_COLORS.length];
    return { name: category.name, tokens: category.tokens, color: color ?? undefined };
  });
}

const estimatedParts = (items: CustomizeItem[]): Part[] =>
  KIND_ORDER.map((kind) => ({ name: KINDS[kind].noun, tokens: sum(items.filter((item) => item.kind === kind), loaded), color: KINDS[kind].color ?? undefined })).filter((part) => part.tokens > 0);

const share = (tokens: number, total: number) => `${Math.round((tokens / total) * 100)}%`;

function Legend({ parts, total }: { parts: Part[]; total: number }) {
  return (
    <ul aria-label="Loaded at session start" className="flex flex-wrap gap-x-5 gap-y-1.5 text-label">
      {parts.map(({ name, tokens, color }) => (
        <li key={name} className="flex items-center gap-1.5">
          <span data-swatch aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="text-ink">{name}</span>
          <span className="tabular-nums text-muted">{formatTokens(tokens)}</span>
          <span className="tabular-nums text-faint">{share(tokens, total)}</span>
        </li>
      ))}
    </ul>
  );
}

function OnUse({ categories }: { categories: Context["categories"] }) {
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-label">
      <span className="text-muted">Loads on use</span>
      <ul aria-label="Loads on use" className="contents">
        {categories.map(({ name, tokens }) => (
          <li key={name} className="flex items-baseline gap-1.5">
            <span className="text-ink">{name}</span>
            <span className="tabular-nums text-muted">{formatTokens(tokens)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContextBar({ data, items }: { data: Customize; items: CustomizeItem[] }) {
  const context = data.context;
  const parts = context ? measuredParts(context) : estimatedParts(items);
  const max = context ? context.max : data.context_max;
  const total = parts.reduce((tokens, part) => tokens + part.tokens, 0);
  const totalText = context ? formatTokens(total) : tokenText(total, isExact(items));
  const percent = Math.round((total / max) * 1000) / 10;
  return (
    <div className={cn(cardClass, "flex flex-col gap-3")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-display font-semibold tabular-nums text-ink">{totalText}</span>
        {!context && <Badge variant="outline">Estimate</Badge>}
        <span className="text-body text-muted">of {formatTokens(max)} tokens load before the first message</span>
        <span className="ml-auto text-label tabular-nums text-muted">{percent}% of the context</span>
      </div>
      <div role="img" aria-label={`${totalText} of ${formatTokens(max)} tokens load at session start, ${percent}% of the context`} className="flex h-2.5 gap-px overflow-hidden rounded-full bg-active">
        {parts.map(({ name, tokens, color }) => (
          <span key={name} className="h-full" style={{ width: `${(tokens / max) * 100}%`, background: color }} />
        ))}
      </div>
      {context && <Legend parts={parts} total={total} />}
      {context && <OnUse categories={context.categories.filter((category) => category.kind === "deferred")} />}
      {data.measured_at && <span className="text-label text-faint">Measured {relativeTime(Date.parse(data.measured_at) / 1000)}</span>}
    </div>
  );
}

function KindCard({ kind, items, onOpen }: { kind: CustomizeKind; items: CustomizeItem[]; onOpen: () => void }) {
  const { label, icon: Icon } = SECTIONS.find((entry) => entry.id === KINDS[kind].section)!;
  const tokens = sum(items, loaded);
  const unknown = tokens === 0 && items.some((item) => item.loaded_tokens === null);
  const color = KINDS[kind].color;
  const off = items.filter((item) => !item.enabled).length;
  return (
    <button type="button" onClick={onOpen} className={cn(cardClass, "flex flex-col gap-2 p-3 text-left ui-focus transition-[border-color,background-color] duration-(--duration-press) hover:border-control")}>
      <span className="flex items-center gap-2 text-label text-muted">
        <Icon aria-hidden className="size-3.5" />
        {label}
        <span className="ml-auto tabular-nums text-ink">{count(items.length)}</span>
      </span>
      <span className="flex items-center gap-1.5 text-heading font-medium tabular-nums text-ink">
        {color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
        {unknown ? "—" : tokenText(tokens, isExact(items))}
        <span className="text-label font-normal text-muted">tokens</span>
      </span>
      <span className="flex gap-2 text-label tabular-nums text-muted">
        {count(sum(items, (item) => item.uses))} uses in 30 days
        {off > 0 && <span className="ml-auto text-faint">{count(off)} off</span>}
      </span>
    </button>
  );
}

const problem = (item: CustomizeItem) => {
  if (item.scan && item.scan.verdict !== "pass") return VERDICT_LABELS[item.scan.verdict];
  if (item.conflicts && item.conflicts.length > 0) return "Duplicate";
  return null;
};

type ListProps = { title: string; items: CustomizeItem[]; value: (item: CustomizeItem) => string; onOpen: (item: CustomizeItem) => void };

function ShortList({ title, items, value, onOpen }: ListProps) {
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-label text-muted">Nothing yet</p>
      ) : (
        <ul aria-label={title} className="divide-y divide-rule">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} className="flex h-9 w-full items-center gap-3 px-4 text-left text-body ui-focus hover:bg-active">
                <span className="min-w-0 truncate text-ink">{item.name}</span>
                <span className="shrink-0 text-label text-muted">{KINDS[item.kind].noun}</span>
                <span className="ml-auto shrink-0 tabular-nums text-ink">{value(item)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function Overview({ data, onSection }: { data: Customize; onSection: (section: SettingsSection) => void }) {
  const items = inContext(data.items);
  const mostUsed = items.filter((item) => RANKED.includes(item.kind) && item.uses > 0).sort((a, b) => b.uses - a.uses).slice(0, TOP);
  const unused = items.filter((item) => loaded(item) > 0 && item.uses === 0).sort((a, b) => loaded(b) - loaded(a)).slice(0, TOP);
  const flagged = data.items.filter(problem);
  const open = (item: CustomizeItem) => onSection(KINDS[item.kind].section);
  return (
    <div className="flex flex-col gap-4">
      {flagged.length > 0 && <ShortList title="Needs a look" items={flagged} value={(item) => problem(item) ?? ""} onOpen={open} />}
      <ContextBar data={data} items={items} />
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {PAGE_KINDS.map((kind) => (
            <KindCard key={kind} kind={kind} items={inSection(data.items, KINDS[kind].section)} onOpen={() => onSection(KINDS[kind].section)} />
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ShortList title="Most used" items={mostUsed} value={(item) => count(item.uses)} onOpen={open} />
        <ShortList title="Loaded but unused in 30 days" items={unused} value={(item) => tokenText(item.loaded_tokens, item.exact)} onOpen={open} />
      </div>
    </div>
  );
}
