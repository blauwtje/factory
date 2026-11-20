import { ContextMenu } from "@base-ui/react/context-menu";
import { Archive, ArchiveRestore, ChevronRight, Copy, Ellipsis, FolderOpen, GitBranch, PanelLeftClose, Pencil, Pin, PinOff, Search, Settings, SlidersVertical, SquarePen, SquareTerminal, Trash2, Type, type LucideIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { popupClass } from "@/components/ui/surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveJob, deleteJob, pinJob, renameJob, resumeCommand } from "@/ipc";
import { isMac, TRAFFIC_LIGHTS } from "@/lib/platform";
import { usePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { UsageMeter } from "@/usage/UsageMeter";
import { Mark, ProjectAvatar } from "./brand";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { arrange, branchName, compactTokens, needsReply, type Arranged } from "./arrange";
import { StatusDot } from "./status";
import { relativeTime } from "./time";
import { STATUS_LABELS, type Page, type ProjectSummary, type SessionSummary } from "./types";
import { ViewOptions } from "./ViewOptions";

type Props = {
  projects: ProjectSummary[];
  page: Page;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHome: () => void;
  onUsage: () => void;
  onNewSession: (projectPath?: string) => void;
  onSearch: () => void;
  onCustomize: (event: MouseEvent<HTMLButtonElement>) => void;
  onSettings: (event: MouseEvent<HTMLButtonElement>) => void;
  onCollapse: () => void;
  onChanged: (removedId?: string) => void;
};

async function copy(message: string, text: string) {
  await navigator.clipboard.writeText(text);
  toast.success(message, { description: text });
}

type RowProps = {
  session: SessionSummary;
  project: ProjectSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  onNewSession: (projectPath?: string) => void;
  onChanged: Props["onChanged"];
};

type ActionsProps = Omit<RowProps, "selected" | "onChanged"> & { onRename: () => void; onResume: () => void; onPin: () => void; onArchive: () => void; onDelete: () => void };

function SessionActions({ session, project, onSelect, onNewSession, onRename, onResume, onPin, onArchive, onDelete }: ActionsProps) {
  return (
    <>
      <DropdownMenuItem onClick={() => onSelect(session.id)}>
        <FolderOpen />
        Open
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNewSession(project.path)}>
        <SquarePen />
        New session in {project.name}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onRename}>
        <Pencil />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onPin}>
        {session.pinned ? <PinOff /> : <Pin />}
        {session.pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => void copy("Copied title", session.title)}>
        <Type />
        Copy title
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void copy("Copied project path", project.path)}>
        <Copy />
        Copy project path
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onResume}>
        <SquareTerminal />
        Copy resume command
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onArchive}>
        {session.archived ? <ArchiveRestore /> : <Archive />}
        {session.archived ? "Unarchive" : "Archive"}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        Delete
      </DropdownMenuItem>
    </>
  );
}

const RESUME_RUNNING_WARNING = "Copied. This session still runs in Factory; resuming it in a terminal as well runs two agents in one worktree.";

async function attempt(task: Promise<unknown>, failure: string) {
  try {
    await task;
    return true;
  } catch (reason) {
    toast.error(failure, { description: String(reason) });
    return false;
  }
}

function SessionRow({ selected, onChanged, ...rest }: RowProps) {
  const { session, onSelect } = rest;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const asking = needsReply(session);
  const word = session.needsReply && session.status !== "awaiting_approval" ? "Needs reply" : STATUS_LABELS[session.status];
  const stamp = session.lastActiveAt ?? session.createdAt;
  const branch = session.branch ? branchName(session.branch) : session.worktree;
  const actions: ActionsProps = {
    ...rest,
    onRename: () => setRenaming(true),
    onResume: async () => {
      try {
        const { command, running } = await resumeCommand(session.id);
        await navigator.clipboard.writeText(command);
        if (running) toast.warning(RESUME_RUNNING_WARNING, { description: command });
        else toast.success("Copied resume command", { description: command });
      } catch (reason) {
        toast.error("Could not copy the resume command", { description: String(reason) });
      }
    },
    onPin: async () => {
      if (await attempt(pinJob(session.id, !session.pinned), "Could not pin the session")) onChanged();
    },
    onArchive: async () => {
      const archived = !session.archived;
      if (await attempt(archiveJob(session.id, archived), `Could not ${archived ? "archive" : "unarchive"} the session`)) onChanged();
    },
    onDelete: () => setConfirmingDelete(true),
  };
  async function confirmRename(title: string) {
    setRenaming(false);
    if (await attempt(renameJob(session.id, title), "Could not rename the session")) onChanged();
  }
  async function confirmDelete() {
    setConfirmingDelete(false);
    if (await attempt(deleteJob(session.id), "Could not delete the session")) onChanged(session.id);
  }
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger className="group/row relative">
          <button
            type="button"
            title={session.title}
            onClick={() => onSelect(session.id)}
            aria-current={selected}
            className={cn(
              "ui-press relative flex h-13 w-full flex-col justify-center gap-1 rounded-lg px-2.5 text-left ui-focus hover:bg-active/50",
              selected && "bg-accent/10 hover:bg-accent/10",
              session.archived && "opacity-60",
            )}
          >
            {selected && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
            <span className="flex w-full min-w-0 items-center gap-2">
              {session.pinned && (
                <>
                  <Pin aria-hidden className="size-3 shrink-0 text-faint" />
                  <span className="sr-only">Pinned</span>
                </>
              )}
              {session.archived && (
                <>
                  <Archive aria-hidden className="size-3 shrink-0 text-faint" />
                  <span className="sr-only">Archived</span>
                </>
              )}
              <span className="min-w-0 flex-1 truncate text-body text-ink">{session.title}</span>
              {stamp !== undefined && (
                <span
                  title={new Date(stamp * 1000).toLocaleString()}
                  className="shrink-0 font-mono text-caption font-medium text-faint transition-opacity duration-(--duration-press) ease-(--ease-out) group-focus-within/row:opacity-0 group-hover/row:opacity-0"
                >
                  {relativeTime(stamp)}
                </span>
              )}
            </span>
            <span className="flex w-full min-w-0 items-center gap-1.5 text-caption text-muted">
              {asking ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" /> : <StatusDot status={session.status} />}
              <span className={cn("shrink-0", asking && "font-medium text-accent-text")}>{word}</span>
              {branch && (
                <span className="flex min-w-0 items-center gap-1">
                  <GitBranch aria-hidden className="size-3 shrink-0 text-faint" />
                  <span className="truncate font-mono">{branch}</span>
                </span>
              )}
              {session.contextTokens !== undefined && <span className="ml-auto shrink-0 tabular-nums text-faint">{compactTokens(session.contextTokens)}</span>}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="More options"
                  className="absolute right-1.5 top-2 opacity-0 transition-[background-color,color,opacity] ease-(--ease-out) group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[popup-open]:opacity-100"
                />
              }
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" sideOffset={4}>
              <SessionActions {...actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="isolate z-50 outline-none">
            <ContextMenu.Popup className={cn(popupClass, "min-w-44 p-1")}>
              <SessionActions {...actions} />
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <RenameSessionDialog title={session.title} open={renaming} onOpenChange={setRenaming} onConfirm={(title) => void confirmRename(title)} />
      <DeleteSessionDialog title={session.title} open={confirmingDelete} onOpenChange={setConfirmingDelete} onConfirm={() => void confirmDelete()} />
    </>
  );
}

type GroupProps = { group: Arranged } & Pick<Props, "selectedId" | "onSelect" | "onNewSession" | "onChanged">;

function Rows({ group, ...rest }: GroupProps) {
  return (
    <div className="flex flex-col gap-0.5 pb-2">
      {group.entries.map(({ session, project }) => (
        <SessionRow key={session.id} session={session} project={project} selected={session.id === rest.selectedId} onSelect={rest.onSelect} onNewSession={rest.onNewSession} onChanged={rest.onChanged} />
      ))}
    </div>
  );
}

function SessionGroup({ group, ...rest }: GroupProps) {
  return (
    <Collapsible defaultOpen render={<section />} className="flex flex-col">
      <h2>
        <CollapsibleTrigger className="ui-press group/project flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left ui-focus">
          {group.project && <ProjectAvatar name={group.project.name} className="size-4 rounded-xs" />}
          <span className="min-w-0 flex-1 truncate text-left text-label font-medium text-muted transition-colors duration-(--duration-press) group-hover/project:text-ink">{group.label}</span>
          <span aria-hidden className="text-caption tabular-nums text-faint">
            · {group.entries.length}
          </span>
          <ChevronRight
            aria-hidden
            className="size-3 text-faint transition-transform duration-(--duration-menu) ease-(--ease-out) group-data-[panel-open]/project:rotate-90"
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent>
        <Rows group={group} {...rest} />
      </CollapsibleContent>
    </Collapsible>
  );
}

const current = (active: boolean) => (active ? "page" : undefined);

export function SidebarHeader({ onCollapse }: Pick<Props, "onCollapse">) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center justify-between gap-2 pl-3 pr-2"
      style={isMac ? { paddingLeft: TRAFFIC_LIGHTS.inset } : undefined}
    >
      <h1 data-tauri-drag-region className="flex min-w-0 items-center gap-2 [&>*]:pointer-events-none">
        <Mark className="size-5" />
        <span className="shrink-0 text-body font-medium text-ink">Factory</span>
      </h1>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Hide sidebar" onClick={onCollapse} />}>
          <PanelLeftClose />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Hide sidebar
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export type NavAction = { label: string; icon: LucideIcon; onClick: (event: MouseEvent<HTMLButtonElement>) => void; active?: boolean };

export function NavList({ actions }: { actions: NavAction[] }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-3">
      {actions.map(({ label, icon: Icon, onClick, active }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-current={current(active ?? false)}
          onClick={onClick}
          className="ui-press flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body text-muted ui-focus hover:bg-active/50 hover:text-ink aria-[current=page]:bg-accent/10 aria-[current=page]:text-accent-text"
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span aria-hidden className="min-w-0 flex-1 truncate">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SidebarFooter({ action: { label, icon: Icon, onClick }, children }: { action: NavAction; children?: ReactNode }) {
  return (
    <div className="border-t border-rule px-2 pb-2 pt-1">
      {children}
      <button
        type="button"
        onClick={onClick}
        className="ui-press flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body text-muted ui-focus hover:bg-active/50 hover:text-ink"
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        {label}
      </button>
    </div>
  );
}

export function Sidebar({ projects, page, selectedId, onSelect, onHome, onUsage, onNewSession, onSearch, onCustomize, onSettings, onCollapse, onChanged }: Props) {
  const [group] = usePref("sessionGroup", "project");
  const [sort] = usePref("sessionSort", "active");
  const [days] = usePref("sessionWindow", 0);
  const [archived] = usePref("showArchived", false);
  const groups = arrange(projects, { group, sort, window: days, archived });
  const accountId = projects.flatMap((project) => project.sessions).find((session) => session.id === selectedId)?.accountId;
  const actions: NavAction[] = [
    { label: "New", icon: SquarePen, onClick: onHome, active: page === "home" },
    { label: "Search", icon: Search, onClick: onSearch },
    { label: "Customize", icon: SlidersVertical, onClick: onCustomize },
  ];
  return (
    <aside className="flex h-full min-w-60 flex-col">
      <SidebarHeader onCollapse={onCollapse} />
      <NavList actions={actions} />

      <div className="flex h-7 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="text-label font-medium text-muted">Sessions</h2>
        <ViewOptions />
      </div>
      <ScrollArea className="flex-1">
        <nav aria-label="Sessions" className="flex flex-col gap-0.5 px-2 pb-3">
          {groups.length === 0 && (
            <div className="flex flex-col gap-0.5 px-2 py-2">
              <span className="text-label font-medium text-muted">No sessions yet</span>
              <span className="text-note text-muted">Start a session and its project appears here.</span>
            </div>
          )}
          {groups.map((entry) =>
            group === "none" ? (
              <Rows key={entry.key} group={entry} selectedId={selectedId} onSelect={onSelect} onNewSession={onNewSession} onChanged={onChanged} />
            ) : (
              <SessionGroup key={entry.key} group={entry} selectedId={selectedId} onSelect={onSelect} onNewSession={onNewSession} onChanged={onChanged} />
            ),
          )}
        </nav>
      </ScrollArea>

      <SidebarFooter action={{ label: "Settings", icon: Settings, onClick: onSettings }}>
        <UsageMeter onOpen={onUsage} accountId={accountId} />
      </SidebarFooter>
    </aside>
  );
}
