import { House, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type TransitionEvent } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Focus } from "@/chat/ChatView";
import { CustomizePage } from "@/customize/CustomizePage";
import { guardLeave } from "@/customize/ItemEditor";
import { JobView } from "@/job/JobView";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/ipc";
import { CommandPalette } from "./CommandPalette";
import { Home, type Compose } from "./Home";
import { NAV_LABELS, SECTIONS, SettingsNav } from "./SettingsNav";
import { SettingsPage, type ClaudeResult } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { StatusBadge } from "./status";
import { TitleActionsProvider, TitleActionsSlot } from "./title-actions";
import { useNotices } from "./notices";
import { enableTranslucency } from "./translucency";
import { withoutArchived, type Page, type ProjectSummary, type SessionSummary, type SettingsSection } from "./types";
import "./shell.css";

const CLAUDE_UNCHECKED: ClaudeResult = { error: "Claude was not checked" };

const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Slide = "in-right" | "in-left" | null;

const slideOnClick = (event: MouseEvent, direction: "in-right" | "in-left"): Slide => (event.detail > 0 ? direction : null);

const isTyping = (element: Element | null) => element?.matches("input, textarea, select, [contenteditable='true']") ?? false;

type Overlay = "settings" | "customize";

const isOverlay = (page: Page): page is Overlay => page === "settings" || page === "customize";

function Breadcrumb({ page, section, selected, onRoot }: { page: Page; section: SettingsSection; selected?: { project: ProjectSummary; session: SessionSummary }; onRoot: () => void }) {
  if (isOverlay(page)) {
    return (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-label">
        <button type="button" onClick={onRoot} className="ui-press -ml-1.5 flex h-7 items-center rounded-md px-1.5 text-muted ui-focus hover:text-ink">
          {NAV_LABELS[page]}
        </button>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span aria-current="page" className="px-1 text-ink">
          {SECTIONS.find((entry) => entry.id === section)?.label}
        </span>
      </nav>
    );
  }
  if (!selected) {
    return (
      <span className="flex items-center gap-2 text-label text-ink">
        <House className="size-3.5 text-muted" aria-hidden />
        Home
      </span>
    );
  }
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2.5 text-label">
      <span className="truncate text-body font-medium text-ink">{selected.session.title}</span>
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="shrink-0 rounded-xs text-muted ui-focus" />}>{selected.project.name}</TooltipTrigger>
        <TooltipContent side="bottom">{selected.project.path}</TooltipContent>
      </Tooltip>
      <StatusBadge status={selected.session.status} />
    </nav>
  );
}

export function Shell({ projects, claude = CLAUDE_UNCHECKED, onSessionsChanged }: { projects: ProjectSummary[]; claude?: ClaudeResult; onSessionsChanged?: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [pageBefore, setPageBefore] = useState<Exclude<Page, Overlay>>("home");
  const [section, setSection] = useState<SettingsSection>("general");
  const [customizeProject, setCustomizeProject] = useState("");
  const [slide, setSlide] = useState<Slide>(null);
  const [compose, setCompose] = useState<Compose>({ key: 0 });
  const [focus, setFocus] = useState<Focus>();
  const jumps = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [sliding, setSliding] = useState(false);
  const sidebar = usePanelRef();
  const layout = useDefaultLayout({ id: "shell", storage: localStorage });

  const selected = projects.flatMap((project) => project.sessions.map((session) => ({ project, session }))).find(({ session }) => session.id === selectedId);
  function select(id: string | null) {
    setSelectedId(id);
    setFocus(undefined);
    setSlide(null);
    setPage(id ? "session" : "home");
  }
  function openHit({ job_id, agent_id, text, seq }: SearchHit) {
    select(job_id);
    setFocus({ agentId: agent_id, text, seq, key: ++jumps.current });
  }
  function closeOverlay(direction: Slide = null) {
    setSlide(direction);
    setPage(pageBefore === "session" && !selected ? "home" : pageBefore);
  }
  function openOverlay(target: Overlay, nextSection: SettingsSection, direction: Slide = null) {
    if (!isOverlay(page)) setPageBefore(page);
    setSection(nextSection);
    setSlide(direction);
    setPage(target);
  }
  function newSession(project_path?: string) {
    select(null);
    setCompose(({ key }) => ({ key: key + 1, project_path }));
  }
  function created(id: string) {
    select(id);
    onSessionsChanged?.();
  }
  function toggleSidebar() {
    setSliding(true);
    if (sidebar.current?.isCollapsed()) sidebar.current.expand();
    else sidebar.current?.collapse();
  }
  const endSlide = (event: TransitionEvent) => event.target === event.currentTarget && setSliding(false);
  const live = withoutArchived(projects);
  function sessionsChanged(removedId?: string) {
    if (removedId && removedId === selectedId) select(null);
    onSessionsChanged?.();
  }

  useNotices(projects, select);

  useEffect(() => void enableTranslucency(), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!isOverlay(page) || paletteOpen || event.defaultPrevented) return;
      if (isTyping(document.activeElement) || document.querySelector(POPUPS)) return;
      closeOverlay();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="shell-frame h-screen bg-frame text-ink">
      <TitleActionsProvider>
        <Group id="shell" orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <Panel
            id="sidebar"
            panelRef={sidebar}
            data-sliding={sliding || undefined}
            defaultSize={300}
            minSize={240}
            maxSize={440}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            style={{ overflow: "hidden" }}
            onTransitionEnd={endSlide}
            onResize={(size) => setCollapsed(size.inPixels === 0)}
          >
            <div key={isOverlay(page) ? page : "app"} data-slide={slide ?? undefined} className="h-full">
              {isOverlay(page) ? (
                <SettingsNav group={page} section={section} onSection={(next) => guardLeave(() => setSection(next))} onNew={(event) => {
                    newSession();
                    setSlide(slideOnClick(event, "in-left"));
                  }} onCollapse={toggleSidebar} />
              ) : (
                <Sidebar
                  projects={projects}
                  page={page}
                  selectedId={page === "session" ? selectedId : null}
                  onSelect={select}
                  onHome={() => newSession()}
                  onUsage={() => openOverlay("settings", "usage")}
                  onNewSession={newSession}
                  onSearch={() => setPaletteOpen(true)}
                  onCustomize={(event) => openOverlay("customize", "overview", slideOnClick(event, "in-right"))}
                  onSettings={(event) => openOverlay("settings", "general", slideOnClick(event, "in-right"))}
                  onCollapse={toggleSidebar}
                  onChanged={sessionsChanged}
                />
              )}
            </div>
          </Panel>
          <Separator className="relative w-px bg-edge outline-none transition-colors duration-(--duration-press) before:absolute before:inset-y-0 before:-left-1 before:-right-2 hover:bg-accent/50 focus-visible:bg-accent focus-visible:shadow-[0_0_0_1px_var(--accent)] data-[separator=active]:bg-accent" />
          <Panel id="main" minSize={480}>
            <div className="flex h-full min-w-0 flex-col bg-surface">
              <header data-tauri-drag-region className={cn("flex h-11 shrink-0 items-center gap-3 pl-4 pr-3", collapsed && (isMac ? "pl-[78px]" : "pl-2"))}>
                {collapsed && (
                  <Tooltip>
                    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show sidebar" onClick={toggleSidebar} />}>
                      <PanelLeftOpen />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Show sidebar
                    </TooltipContent>
                  </Tooltip>
                )}
                <Breadcrumb page={page} section={section} selected={selected} onRoot={() => setSection(page === "customize" ? "overview" : "general")} />
                <TitleActionsSlot />
              </header>
              <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div key={page === "session" ? selectedId : page} className="flex min-h-0 flex-1 flex-col">
                  {page === "settings" && <SettingsPage claude={claude} section={section} />}
                  {page === "customize" && (
                    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-8 pb-6 pt-10">
                      <CustomizePage section={section} project={customizeProject} onProject={setCustomizeProject} onSection={setSection} />
                    </div>
                  )}
                  {page === "session" && selectedId && <JobView key={selectedId} jobId={selectedId} focus={focus} onCustomizeMcp={() => openOverlay("customize", "mcp")} />}
                  {page === "home" && <Home projects={live} compose={compose} onOpen={select} onCreated={created} />}
                </div>
              </main>
            </div>
          </Panel>
        </Group>
      </TitleActionsProvider>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={live}
        onSelect={select}
        onOpenHit={openHit}
        onHome={() => newSession()}
        onStatistics={() => openOverlay("settings", "statistics")}
        onCustomize={() => openOverlay("customize", "overview")}
        onSettings={() => openOverlay("settings", "general")}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  );
}
