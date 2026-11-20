import { ArrowDown, ArrowUp } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { CustomizeItem, CustomizeSource } from "@/ipc";
import { cn } from "@/lib/utils";
import { cardClass } from "@/settings/parts";
import { count } from "@/stats/format";
import { VERDICT_LABELS, lastUsedText, sourceLabel, tokenText } from "./kinds";

type SortKey = "loaded" | "uses";
type Sort = { key: SortKey; desc: boolean };

const SORT_VALUE: Record<SortKey, (item: CustomizeItem) => number> = {
  loaded: (item) => item.loaded_tokens ?? -1,
  uses: (item) => item.uses,
};

type Column = { label: string; numeric?: boolean; hide?: string; sort?: SortKey; cell: (item: CustomizeItem) => ReactNode };

const COLUMNS: Column[] = [
  { label: "Source", hide: "@max-md:hidden", cell: sourceLabel },
  {
    label: "Invoked",
    hide: "@max-2xl:hidden",
    cell: (item) => (
      <span title={item.invocation} className="block max-w-52 truncate">
        {item.invocation}
      </span>
    ),
  },
  { label: "Loaded", numeric: true, sort: "loaded", cell: (item) => tokenText(item.loaded_tokens, item.exact) },
  { label: "On use", numeric: true, hide: "@max-xl:hidden", cell: (item) => tokenText(item.use_tokens, false) },
  { label: "Uses (30d)", numeric: true, sort: "uses", cell: (item) => count(item.uses) },
  { label: "Last used", numeric: true, hide: "@max-3xl:hidden", cell: (item) => lastUsedText(item.last_used) },
];

const SCOPE_LABELS: Record<NonNullable<CustomizeItem["scope"]>, string> = { user: "User", project: "Project", local: "Local" };

const folderName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

function ScopeText({ scope, projectPath }: { scope: CustomizeItem["scope"]; projectPath: string | null }) {
  if (!scope) return "—";
  if (scope === "user" || !projectPath) return SCOPE_LABELS[scope];
  return (
    <span title={projectPath}>
      {SCOPE_LABELS[scope]} · {folderName(projectPath)}
    </span>
  );
}

export const pluginColumns = (projectPath: string | null): Column[] => [
  {
    label: "From",
    hide: "@max-md:hidden",
    cell: (item) => (
      <span title={item.origin ?? undefined} className="block max-w-52 truncate">
        {item.origin ?? "—"}
      </span>
    ),
  },
  { label: "Scope", cell: (item) => <ScopeText scope={item.scope} projectPath={projectPath} /> },
  ...COLUMNS.filter((column) => column.label !== "Source"),
];

const SOURCE_ORDER: Record<CustomizeSource, number> = { project: 0, user: 1, factory: 2, plugin: 3 };

const groupLabel = (item: CustomizeItem) => (item.source === "plugin" ? `Plugin · ${sourceLabel(item)}` : sourceLabel(item));

type Group = { label: string | null; origin: string | null; items: CustomizeItem[] };

function groupsOf(items: CustomizeItem[]): Group[] {
  const ordered = [...items].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || groupLabel(a).localeCompare(groupLabel(b)));
  return [...new Set(ordered.map(groupLabel))].map((label) => {
    const members = ordered.filter((item) => groupLabel(item) === label);
    return { label, origin: members[0].origin ?? null, items: members };
  });
}

const matches = (item: CustomizeItem, query: string) => `${item.name}\n${item.description}`.toLowerCase().includes(query.toLowerCase());

const sorted = (items: CustomizeItem[], { key, desc }: Sort) =>
  [...items].sort((a, b) => (SORT_VALUE[key](b) - SORT_VALUE[key](a)) * (desc ? 1 : -1) || a.name.localeCompare(b.name));

function SortHeader({ column, sort, onSort }: { column: Column & { sort: SortKey }; sort: Sort; onSort: (sort: Sort) => void }) {
  const active = sort.key === column.sort;
  const Arrow = active && !sort.desc ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: column.sort, desc: active ? !sort.desc : true })}
      className={cn("inline-flex items-center gap-1 rounded-sm ui-focus hover:text-ink", active && "text-ink")}
    >
      {column.label}
      <Arrow aria-hidden className={cn("size-3", !active && "opacity-0")} />
    </button>
  );
}

const ariaSort = (column: Column, sort: Sort) => (column.sort ? (sort.key === column.sort ? (sort.desc ? "descending" : "ascending") : "none") : undefined);

function VerdictBadge({ item }: { item: CustomizeItem }) {
  const verdict = item.scan?.verdict;
  if (!verdict || verdict === "pass") return null;
  return <Badge variant={verdict === "risk" ? "failed" : "waiting"}>{VERDICT_LABELS[verdict]}</Badge>;
}

export type Detail = { label: string; wide?: boolean; content: ReactNode };

export function focusRow(id: string) {
  const button = [...document.querySelectorAll<HTMLElement>("[data-item]")].find((element) => element.dataset.item === id);
  button?.focus();
  return button !== undefined;
}

type Props = {
  items: CustomizeItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  detail: Detail | null;
  empty: string;
  searchLabel?: string;
  columns?: Column[];
  grouped?: boolean;
  trailing?: (item: CustomizeItem) => ReactNode;
  actions?: ReactNode;
};

export function ItemBrowser({ items, selected, onSelect, detail, empty, searchLabel = "Search", columns = COLUMNS, grouped, trailing, actions }: Props) {
  const [sort, setSort] = useState<Sort>({ key: "loaded", desc: true });
  const [query, setQuery] = useState("");
  const detailId = useId();
  const cellClass = "px-3 py-2 align-middle";
  const shown = items.filter((item) => matches(item, query.trim()));
  const groups: Group[] = grouped ? groupsOf(shown) : [{ label: null, origin: null, items: shown }];
  const message = items.length === 0 ? empty : shown.length === 0 ? `Nothing matches “${query.trim()}”.` : null;

  const row = (item: CustomizeItem) => {
    const open = item.id === selected;
    const end = trailing?.(item);
    return (
      <tr
        key={item.id}
        data-selected={open || undefined}
        onClick={() => onSelect(open ? null : item.id)}
        className="cursor-default transition-colors duration-(--duration-press) hover:bg-active/50 data-[selected]:bg-active [&:not(:first-child)>td]:border-t [&>td]:border-rule"
      >
        <td className="w-full max-w-0 py-2 pl-4 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-item={item.id}
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(open ? null : item.id);
              }}
              className={cn("min-w-0 truncate rounded-sm text-left font-medium ui-focus", item.enabled ? "text-ink" : "text-muted")}
            >
              {item.name}
            </button>
            {item.kind === "command" && <Badge variant="secondary">Command</Badge>}
            <VerdictBadge item={item} />
            {item.conflicts && item.conflicts.length > 0 && <Badge variant="outline">Duplicate</Badge>}
            {!item.enabled && !end && <Badge variant="outline">Off</Badge>}
          </div>
          {item.description && <p className="truncate text-label text-muted">{item.description}</p>}
        </td>
        {columns.map((column) => (
          <td key={column.label} className={cn(cellClass, "whitespace-nowrap", column.numeric ? "text-right tabular-nums text-ink" : "text-muted", column.hide)}>
            {column.cell(item)}
          </td>
        ))}
        {trailing && (
          <td className="py-2 pl-3 pr-4" onClick={(event) => event.stopPropagation()}>
            {end}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className={cn("grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4", detail && (detail.wide ? "grid-cols-[minmax(0,1fr)_28rem]" : "grid-cols-[minmax(0,1fr)_20rem]"))}>
      <div className="flex min-h-0 flex-col gap-3">
        {(items.length > 0 || actions) && (
          <div className="flex items-center gap-3">
            {items.length > 0 && <Input type="search" aria-label={searchLabel} placeholder="Search by name or description" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-72" />}
            {actions && <div className="ml-auto">{actions}</div>}
          </div>
        )}
        <div data-scroll-inside className={cn(cardClass, "@container min-h-0 flex-1 overflow-auto p-0")}>
          {message ? (
            <p className="px-4 py-6 text-body text-pretty text-muted">{message}</p>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-body">
              <thead>
                <tr className="text-left text-label text-muted">
                  <th scope="col" className="sticky top-0 z-10 bg-raised py-2 pl-4 pr-3 font-medium shadow-[inset_0_-1px_0_var(--rule)]">
                    Name
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.label}
                      scope="col"
                      aria-sort={ariaSort(column, sort)}
                      className={cn("sticky top-0 z-10 whitespace-nowrap bg-raised py-2 font-medium shadow-[inset_0_-1px_0_var(--rule)]", cellClass, column.numeric && "text-right", column.hide)}
                    >
                      {column.sort ? <SortHeader column={{ ...column, sort: column.sort }} sort={sort} onSort={setSort} /> : column.label}
                    </th>
                  ))}
                  {trailing && (
                    <th scope="col" className="sticky top-0 z-10 bg-raised py-2 pl-3 pr-4 shadow-[inset_0_-1px_0_var(--rule)]">
                      <span className="sr-only">On</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.label ?? ""}>
                    {group.label && (
                      <tr className="[&:first-child>th]:pt-2">
                        <th scope="colgroup" colSpan={columns.length + (trailing ? 2 : 1)} className="px-4 pb-1.5 pt-5 text-left text-label font-medium text-muted">
                          {group.label}
                          {group.origin && <span className="ml-2 font-normal text-faint">{group.origin}</span>}
                        </th>
                      </tr>
                    )}
                    {sorted(group.items, sort).map(row)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {detail && (
        <section id={detailId} aria-label={detail.label} data-scroll-inside className="min-h-0 self-start overflow-y-auto rounded-xl max-h-full">
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

const READ_ONLY: CustomizeSource[] = ["factory", "plugin"];

export function ItemDetail({ item, actions, error }: { item: CustomizeItem; actions?: ReactNode; error?: string | null }) {
  return (
    <div className={cn(cardClass, "flex flex-col gap-4")}>
      <div className="flex flex-col gap-1">
        <h4 className="text-title font-medium break-words text-ink">{item.name}</h4>
        {item.description && <p className="text-body text-pretty text-muted">{item.description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      {error && (
        <p role="alert" className="text-label text-failed-ink">
          {error}
        </p>
      )}
      {READ_ONLY.includes(item.source) && <p className="text-label text-muted">Read-only, from {sourceLabel(item)}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body">
        <Fact label="Invoked">{item.invocation}</Fact>
        <Fact label="Source">{sourceLabel(item)}</Fact>
        <Fact label="State">{item.enabled ? "On" : "Off"}</Fact>
        {item.origin && <Fact label="From">{item.origin}</Fact>}
        {item.scope && <Fact label="Scope">{SCOPE_LABELS[item.scope]}</Fact>}
        {item.version && <Fact label="Version">{item.version}</Fact>}
        <Fact label="Loaded">
          <span className="tabular-nums">{tokenText(item.loaded_tokens, item.exact)}</span>
        </Fact>
        <Fact label="On use">
          <span className="tabular-nums">{tokenText(item.use_tokens, false)}</span>
        </Fact>
        <Fact label="Uses (30d)">
          <span className="tabular-nums">{count(item.uses)}</span>
        </Fact>
        <Fact label="Last used">{lastUsedText(item.last_used)}</Fact>
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
