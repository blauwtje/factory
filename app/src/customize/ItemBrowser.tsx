import { Lock, Search } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomizeItem, CustomizeSource } from "@/ipc";
import { readPersisted, writePersisted } from "@/lib/persisted";
import { cn } from "@/lib/utils";
import { cardClass } from "@/settings/parts";
import { count } from "@/stats/format";
import { isOwn, KINDS, lastUsedText, sourceLabel, tokenText, VERDICT_LABELS } from "./kinds";

type SortKey = "uses" | "loaded" | "name";
type Filter = "all" | "on" | "off" | "own" | "unused";
type View = { sort: SortKey; filter: Filter };

const DEFAULT_VIEW: View = { sort: "uses", filter: "all" };

const SORTS: { value: SortKey; label: string }[] = [
  { value: "uses", label: "Most used" },
  { value: "loaded", label: "Largest" },
  { value: "name", label: "A–Z" },
];

const FILTERS: { value: Filter; label: string; keep: (item: CustomizeItem) => boolean }[] = [
  { value: "all", label: "All", keep: () => true },
  { value: "on", label: "On", keep: (item) => item.enabled },
  { value: "off", label: "Off", keep: (item) => !item.enabled },
  { value: "own", label: "Yours", keep: isOwn },
  { value: "unused", label: "Unused", keep: (item) => item.uses === 0 },
];

const ORDER: Record<SortKey, (a: CustomizeItem, b: CustomizeItem) => number> = {
  uses: (a, b) => b.uses - a.uses,
  loaded: (a, b) => (b.loaded_tokens ?? -1) - (a.loaded_tokens ?? -1),
  name: () => 0,
};

const sorted = (items: CustomizeItem[], key: SortKey) => [...items].sort((a, b) => ORDER[key](a, b) || a.name.localeCompare(b.name));

const SCOPE_LABELS: Record<NonNullable<CustomizeItem["scope"]>, string> = { user: "User", project: "Project", local: "Local" };

const folderName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

const scopeText = (scope: CustomizeItem["scope"], projectPath: string | null) => {
  if (!scope) return null;
  if (scope === "user" || !projectPath) return SCOPE_LABELS[scope];
  return `${SCOPE_LABELS[scope]} · ${folderName(projectPath)}`;
};

const SOURCE_ORDER: Record<CustomizeSource, number> = { project: 0, user: 1, factory: 2, plugin: 3 };
const GROUP_TITLES: Record<Exclude<CustomizeSource, "plugin">, string> = { project: "This project", user: "All your projects", factory: "Factory" };

const groupTitle = (item: CustomizeItem) => (item.source === "plugin" ? `Plugin · ${sourceLabel(item)}` : GROUP_TITLES[item.source]);

function groupHint(item: CustomizeItem, projectPath: string | null) {
  if (item.source === "project") return projectPath ? `Only in ${folderName(projectPath)}. You can change these.` : "You can change these.";
  if (item.source === "user") return "Every project. You can change these.";
  if (item.source === "factory") return "Built into Factory.";
  return item.origin ?? "Read-only";
}

type Group = { title: string | null; hint: string | null; items: CustomizeItem[] };

function groupsOf(items: CustomizeItem[], projectPath: string | null): Group[] {
  const ordered = [...items].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || groupTitle(a).localeCompare(groupTitle(b)));
  return [...new Set(ordered.map(groupTitle))].map((title) => {
    const members = ordered.filter((item) => groupTitle(item) === title);
    return { title, hint: groupHint(members[0], projectPath), items: members };
  });
}

const matches = (item: CustomizeItem, query: string) => `${item.name}\n${item.description}`.toLowerCase().includes(query.toLowerCase());

function useView(key: string) {
  const storeKey = `customize-view:${key}`;
  const [view, setView] = useState<View>(() => ({ ...DEFAULT_VIEW, ...readPersisted<View>(storeKey) }));
  const change = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    setView(next);
    writePersisted(storeKey, next);
  };
  return [view, change] as const;
}

function useSlashFocus(id: string) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const box = document.getElementById(id);
      if (!box) return;
      event.preventDefault();
      box.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);
}

function Badges({ item }: { item: CustomizeItem }) {
  const verdict = item.scan?.verdict;
  return (
    <>
      {item.kind === "command" && <Badge variant="secondary">Command</Badge>}
      {verdict && verdict !== "pass" && <Badge variant={verdict === "risk" ? "failed" : "approval"}>{VERDICT_LABELS[verdict]}</Badge>}
      {item.conflicts && item.conflicts.length > 0 && <Badge variant="outline">Duplicate</Badge>}
      {!item.enabled && <Badge variant="outline">Off</Badge>}
    </>
  );
}

function usageText(item: CustomizeItem, projectPath: string | null) {
  const used = item.uses > 0 ? `${count(item.uses)} ${item.uses === 1 ? "use" : "uses"}, last ${lastUsedText(item.last_used)}` : "Not used in 30 days";
  if (item.kind !== "plugin") return used;
  return [item.origin, scopeText(item.scope, projectPath), used].filter(Boolean).join(" · ");
}

function Weight({ item, max }: { item: CustomizeItem; max: number }) {
  const tokens = item.loaded_tokens ?? 0;
  const share = max > 0 && tokens > 0 ? Math.max(0.06, tokens / max) : 0;
  return (
    <span className="flex w-16 shrink-0 flex-col items-end gap-1.5">
      <span className="text-label tabular-nums text-muted">{tokenText(item.loaded_tokens, item.exact)}</span>
      <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-active">
        <span data-weight className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: KINDS[item.kind].color ?? "var(--chart-other)" }} />
      </span>
    </span>
  );
}

type RowProps = { item: CustomizeItem; open: boolean; controls: string; max: number; projectPath: string | null; end: ReactNode; endWidth: boolean; onSelect: (id: string | null) => void };

function ItemRow({ item, open, controls, max, projectPath, end, endWidth, onSelect }: RowProps) {
  const nameId = useId();
  const descriptionId = useId();
  const badgesId = useId();
  return (
    <li data-selected={open || undefined} className="relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-(--duration-press) hover:bg-active/40 data-[selected]:bg-active">
      <button
        type="button"
        data-item={item.id}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        aria-labelledby={nameId}
        aria-describedby={item.description ? `${badgesId} ${descriptionId}` : badgesId}
        onClick={() => onSelect(open ? null : item.id)}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-sm text-left ui-focus after:absolute after:inset-0"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span id={nameId} className={cn("min-w-0 truncate text-body font-medium", item.enabled ? "text-ink" : "text-muted")}>
              {item.name}
            </span>
            <span id={badgesId} className="contents">
              <Badges item={item} />
            </span>
          </span>
          {item.description && (
            <span id={descriptionId} className="truncate text-label text-muted">
              {item.description}
            </span>
          )}
          <span className="truncate text-caption tabular-nums text-faint">{usageText(item, projectPath)}</span>
        </span>
        <Weight item={item} max={max} />
      </button>
      {endWidth && <div className="relative z-10 flex w-16 shrink-0 items-center justify-end gap-0.5">{end}</div>}
    </li>
  );
}

export type Detail = { label: string; wide?: boolean; content: ReactNode };

export function focusRow(id: string) {
  const button = [...document.querySelectorAll<HTMLElement>("[data-item]")].find((element) => element.dataset.item === id);
  button?.focus();
  return button !== undefined;
}

export function ReadOnlyMark({ item }: { item: CustomizeItem }) {
  return (
    <span title={`Read-only, from ${sourceLabel(item)}`} className="flex size-7 items-center justify-center text-faint">
      <Lock aria-label={`${item.name} is read-only`} className="size-3.5" />
    </span>
  );
}

type Props = {
  items: CustomizeItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  detail: Detail | null;
  empty: string;
  viewKey?: string;
  projectPath?: string | null;
  searchLabel?: string;
  grouped?: boolean;
  rowEnd?: (item: CustomizeItem) => ReactNode;
  actions?: ReactNode;
};

export function ItemBrowser({ items, selected, onSelect, detail, empty, viewKey = "default", projectPath = null, searchLabel = "Search", grouped, rowEnd, actions }: Props) {
  const [view, setView] = useView(viewKey);
  const [query, setQuery] = useState("");
  const detailId = useId();
  const searchId = useId();
  useSlashFocus(searchId);
  const filters = FILTERS.filter(({ value, keep }) => {
    const kept = items.filter(keep).length;
    return value === "all" || (kept > 0 && kept < items.length);
  });
  const filter = filters.find((entry) => entry.value === view.filter) ?? FILTERS[0];
  const shown = sorted(
    items.filter((item) => filter.keep(item) && matches(item, query.trim())),
    view.sort,
  );
  const groups: Group[] = grouped ? groupsOf(shown, projectPath) : [{ title: null, hint: null, items: shown }];
  const max = Math.max(0, ...items.map((item) => item.loaded_tokens ?? 0));
  const endWidth = rowEnd !== undefined && items.some((item) => rowEnd(item));
  const narrowed = query.trim() !== "" || filter.value !== "all";

  const clear = () => {
    setQuery("");
    setView({ filter: "all" });
  };

  const list = () => {
    if (items.length === 0) {
      return (
        <div className={cn(cardClass, "flex flex-col items-start gap-3 px-5 py-6")}>
          <p className="text-body text-pretty text-muted">{empty}</p>
        </div>
      );
    }
    if (shown.length === 0) {
      return (
        <div className={cn(cardClass, "flex flex-col items-start gap-3 px-5 py-6")}>
          <p className="text-body text-pretty text-muted">{query.trim() ? `Nothing matches “${query.trim()}”.` : "Nothing to show with this filter."}</p>
          <Button variant="outline" size="sm" onClick={clear}>
            Show all
          </Button>
        </div>
      );
    }
    return groups.map((group) => (
      <div key={group.title ?? ""} role="group" aria-label={group.title ?? "Items"} className="flex flex-col gap-1.5">
        <div className="flex items-end gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {group.title && <h4 className="shrink-0 text-label font-medium text-ink">{group.title}</h4>}
            {group.hint && <span className="min-w-0 truncate text-label text-faint">{group.hint}</span>}
          </div>
          <span className="w-16 shrink-0 text-right text-caption text-faint">At start</span>
          {endWidth && <span aria-hidden className="w-16 shrink-0" />}
        </div>
        <ul aria-label={group.title ?? searchLabel} className={cn(cardClass, "divide-y divide-rule overflow-hidden p-0")}>
          {group.items.map((item) => (
            <ItemRow key={item.id} item={item} open={item.id === selected} controls={detailId} max={max} projectPath={projectPath} end={rowEnd?.(item) ?? null} endWidth={endWidth} onSelect={onSelect} />
          ))}
        </ul>
      </div>
    ));
  };

  return (
    <div className={cn("grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-x-5 gap-y-4", detail && (detail.wide ? "grid-cols-[minmax(0,1fr)_28rem]" : "grid-cols-[minmax(0,1fr)_21rem]"))}>
      <div className={cn("flex flex-wrap items-center gap-2", detail && "col-span-2")}>
        {items.length > 0 && (
          <>
            <div className="relative w-64 max-w-full">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                id={searchId}
                type="search"
                aria-label={searchLabel}
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && query && (event.preventDefault(), setQuery(""))}
                className="pr-8 pl-8"
              />
              {!query && <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>}
            </div>
            {filters.length > 1 && (
              <ToggleGroup aria-label="Show" value={[filter.value]} onValueChange={([next]) => next && setView({ filter: next as Filter })}>
                {filters.map(({ value, label, keep }) => (
                  <ToggleGroupItem key={value} value={value} aria-label={label}>
                    {label}
                    <span className="text-label tabular-nums text-faint">{items.filter(keep).length}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {items.length > 1 && (
            <ToggleGroup aria-label="Sort by" value={[view.sort]} onValueChange={([next]) => next && setView({ sort: next as SortKey })}>
              {SORTS.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {actions}
        </div>
      </div>
      <div data-scroll-inside className="flex min-h-0 flex-col gap-5 overflow-y-auto pb-2">
        {list()}
        {narrowed && shown.length > 0 && (
          <p className="px-4 text-label text-faint">
            {count(shown.length)} of {count(items.length)} shown.{" "}
            <button type="button" onClick={clear} className="rounded-sm text-accent-text ui-focus hover:underline">
              Show all
            </button>
          </p>
        )}
      </div>
      {detail && (
        <section id={detailId} aria-label={detail.label} data-scroll-inside className="max-h-full min-h-0 self-start overflow-y-auto rounded-xl">
          {detail.content}
        </section>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-well px-3 py-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-title font-medium tabular-nums text-ink">{children}</dd>
    </div>
  );
}

const READ_ONLY: CustomizeSource[] = ["factory", "plugin"];

export function ItemDetail({ item, actions, error }: { item: CustomizeItem; actions?: ReactNode; error?: string | null }) {
  return (
    <div className={cn(cardClass, "flex flex-col gap-5")}>
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="min-w-0 text-title font-medium break-words text-ink">{item.name}</h4>
          <Badge variant={item.enabled ? "done" : "outline"}>{item.enabled ? "On" : "Off"}</Badge>
        </div>
        {item.description && <p className="text-body text-pretty text-muted">{item.description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      {error && (
        <p role="alert" className="text-label text-failed-ink">
          {error}
        </p>
      )}
      {READ_ONLY.includes(item.source) && (
        <p className="flex items-center gap-1.5 text-label text-muted">
          <Lock aria-hidden className="size-3.5" />
          Read-only, from {sourceLabel(item)}
        </p>
      )}
      <dl aria-label="Usage" className="grid grid-cols-2 gap-2">
        <Stat label="Uses (30d)">{count(item.uses)}</Stat>
        <Stat label="Last used">{lastUsedText(item.last_used)}</Stat>
        <Stat label="At session start">{tokenText(item.loaded_tokens, item.exact)}</Stat>
        <Stat label="When used">{tokenText(item.use_tokens, false)}</Stat>
      </dl>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body">
        <Fact label="Starts by">{item.invocation}</Fact>
        <Fact label="Source">{sourceLabel(item)}</Fact>
        {item.origin && <Fact label="From">{item.origin}</Fact>}
        {item.scope && <Fact label="Scope">{SCOPE_LABELS[item.scope]}</Fact>}
        {item.version && <Fact label="Version">{item.version}</Fact>}
      </dl>
      <div className="flex flex-col gap-1">
        <span className="text-label text-muted">{item.kind === "plugin" ? "Install path" : "Path"}</span>
        <p className="font-mono text-note break-all text-ink">{item.path}</p>
      </div>
      {item.scan && item.scan.findings.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">Scan</span>
          <ul className="flex flex-col gap-0.5 text-body text-ink">
            {item.scan.findings.map((finding) => (
              <li key={finding.reason}>{finding.reason}</li>
            ))}
          </ul>
          <p className="text-note text-muted">Heuristic check; it can flag safe files.</p>
        </div>
      )}
      {item.conflicts && item.conflicts.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">Same name in</span>
          <ul className="flex flex-col gap-0.5 font-mono text-note break-all text-ink">
            {item.conflicts.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
