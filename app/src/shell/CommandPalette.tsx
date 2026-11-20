import { Autocomplete } from "@base-ui/react/autocomplete";
import { Bot, ChartColumn, CornerDownLeft, House, PanelLeft, Search, Settings, SlidersVertical, User, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { searchSessions, type SearchHit } from "@/ipc";
import { ProjectAvatar } from "./brand";
import { cn } from "@/lib/utils";
import { STATUS_TONE, STATUS_WORD, StatusDot } from "./status";
import { STATUS_LABELS, type JobStatus, type ProjectSummary, type SessionSummary } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  onSelect: (id: string) => void;
  onOpenHit: (hit: SearchHit) => void;
  onHome: () => void;
  onStatistics: () => void;
  onCustomize: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
};

type Entry = { id: string; label: string; icon: ReactNode; status?: JobStatus; project?: string; hit?: SearchHit; run: () => void };
type Group = { value: string; icon?: ReactNode; items: Entry[] };

const RECENT = 4;
const MIN_QUERY = 2;

const icon = (Icon: LucideIcon) => <Icon className="size-4 shrink-0 text-muted" aria-hidden />;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Marked({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter((term) => term.length >= MIN_QUERY).sort((a, b) => b.length - a.length).map(escape);
  if (terms.length === 0) return text;
  return text.split(new RegExp(`(${terms.join("|")})`, "gi")).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-xs bg-accent-soft px-0.5 text-accent-text">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function StatusWord({ status }: { status: JobStatus }) {
  const word = STATUS_WORD[status];
  const tone = STATUS_TONE[status];
  return <span className={cn("shrink-0 text-label", word?.className ?? (tone === "running" ? "text-running-ink" : "text-faint"))}>{word?.word ?? STATUS_LABELS[status]}</span>;
}

const newestFirst = (a: SessionSummary, b: SessionSummary) => (b.createdAt ?? 0) - (a.createdAt ?? 0);

const latest = (project: ProjectSummary) => Math.max(0, ...project.sessions.map((session) => session.createdAt ?? 0));

export function CommandPalette({ open, onOpenChange, projects, onSelect, onOpenHit, onHome, onStatistics, onCustomize, onSettings, onToggleSidebar }: Props) {
  useEffect(() => {
    function toggle(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onOpenChange(!open);
    }
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [open, onOpenChange]);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const { contains } = Autocomplete.useFilter();

  if (!open && query !== "") setQuery("");

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) return;
    let stale = false;
    searchSessions(text).then((found) => {
      if (!stale) setHits(found);
    });
    return () => {
      stale = true;
    };
  }, [query]);

  const hitEntry = (hit: SearchHit): Entry => ({
    id: `${hit.agent_id}:${hit.seq}`,
    label: hit.snippet,
    icon: icon(hit.role === "user" ? User : Bot),
    project: hit.title,
    hit,
    run: () => onOpenHit(hit),
  });

  const sessionEntry = (session: SessionSummary, project?: ProjectSummary): Entry => ({
    id: session.id,
    label: session.title,
    icon: <StatusDot status={session.status} className="mx-1" />,
    status: session.status,
    project: project?.name,
    run: () => onSelect(session.id),
  });

  const recent = projects
    .flatMap((project) => project.sessions.filter((session) => session.createdAt !== undefined).map((session) => ({ project, session })))
    .sort((a, b) => newestFirst(a.session, b.session))
    .slice(0, RECENT);
  const isRecent = (session: SessionSummary) => recent.some((entry) => entry.session.id === session.id);

  const groups: Group[] = [
    { value: "Recent", items: recent.map(({ project, session }) => sessionEntry(session, project)) },
    {
      value: "Actions",
      items: [
        { id: "home", label: "Go home", icon: icon(House), run: onHome },
        { id: "statistics", label: "Statistics", icon: icon(ChartColumn), run: onStatistics },
        { id: "customize", label: "Customize", icon: icon(SlidersVertical), run: onCustomize },
        { id: "sidebar", label: "Toggle sidebar", icon: icon(PanelLeft), run: onToggleSidebar },
        { id: "settings", label: "Settings", icon: icon(Settings), run: onSettings },
      ],
    },
    ...[...projects]
      .sort((a, b) => latest(b) - latest(a))
      .map((project) => ({
        value: project.name,
        icon: <ProjectAvatar name={project.name} className="size-4 rounded-xs" />,
        items: project.sessions
          .filter((session) => !isRecent(session))
          .sort(newestFirst)
          .map((session) => sessionEntry(session)),
      })),
    { value: "Messages", items: (query.trim().length < MIN_QUERY ? [] : hits).map(hitEntry) },
  ].filter((group) => group.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent instant className="top-[calc(50%-min(16rem,50dvh-1.5rem))] flex max-h-[min(32rem,calc(100dvh-3rem))] max-w-[min(42rem,calc(100vw-2rem))] translate-y-0 flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          inline
          open
          autoHighlight="always"
          items={groups}
          value={query}
          onValueChange={setQuery}
          filter={(entry: Entry, text, itemToString) => entry.hit !== undefined || contains(entry, text, itemToString)}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-rule px-5">
            <Search aria-hidden className="size-5 shrink-0 text-faint" />
            <CommandInput placeholder="Search sessions and actions" className="border-0 px-0 py-4 text-heading" />
          </div>
          <CommandEmpty className="flex flex-col items-center gap-1 px-6 py-10 text-center empty:hidden">
            <span className="text-body text-ink">Nothing matches “{query.trim()}”</span>
            <span className="text-label text-muted">{query.trim().length < MIN_QUERY ? "Type two or more characters to search messages too." : "Sessions, actions and messages were searched."}</span>
          </CommandEmpty>
          <CommandList className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 empty:hidden">
            {(group: Group) => (
              <Autocomplete.Group key={group.value} items={group.items}>
                <Autocomplete.GroupLabel className="sticky top-0 z-10 flex items-center gap-2 bg-overlay px-3 pb-1.5 pt-3 text-caption font-medium text-faint">
                  {group.icon}
                  {group.value}
                </Autocomplete.GroupLabel>
                <Autocomplete.Collection>
                  {(entry: Entry) => (
                    <CommandItem
                      key={entry.id}
                      value={entry}
                      onClick={() => {
                        onOpenChange(false);
                        entry.run();
                      }}
                      className={cn("group min-h-9 gap-3 rounded-lg px-3", entry.hit && "items-start py-2.5")}
                    >
                      <span aria-hidden className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-accent group-data-[highlighted]:block" />
                      <span className={cn("flex size-4 shrink-0 items-center justify-center", entry.hit && "mt-0.5")}>{entry.icon}</span>
                      {entry.hit ? (
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="line-clamp-2 text-body text-pretty text-ink">
                            <Marked text={entry.label} query={query} />
                          </span>
                          <span className="truncate text-label text-faint">
                            {entry.hit.role === "user" ? "You" : "Agent"} in {entry.project}
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                          {entry.project && <span className="max-w-40 shrink-0 truncate text-label text-faint">{entry.project}</span>}
                          {entry.status && <StatusWord status={entry.status} />}
                        </>
                      )}
                      <CornerDownLeft aria-hidden className={cn("hidden size-3.5 shrink-0 text-faint group-data-[highlighted]:block", entry.hit && "mt-1")} />
                    </CommandItem>
                  )}
                </Autocomplete.Collection>
              </Autocomplete.Group>
            )}
          </CommandList>
          <div className="flex shrink-0 items-center gap-4 border-t border-rule px-5 py-2.5 text-label text-faint">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              to open
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              to close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
