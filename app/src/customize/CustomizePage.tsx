import { RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup as SegmentedGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { customizeKey, listCustomize, measureCustomize, resetRole, type Customize, type CustomizeItem, type CustomizeKind } from "@/ipc";
import { cached, remember } from "@/lib/cache";
import { cn } from "@/lib/utils";
import { NEW_ROLE, RoleEditor, TeamDefaults, useRoles } from "@/settings/AgentsTab";
import { Section } from "@/settings/parts";
import { SkillSwitch } from "@/settings/SkillsTab";
import { ProjectPicker } from "@/shell/ProjectPicker";
import { SECTIONS } from "@/shell/SettingsNav";
import type { SettingsSection } from "@/shell/types";
import { ItemBrowser, pluginColumns, type Detail } from "./ItemBrowser";
import { canEdit, guardLeave, NewMenu, useItemEditor } from "./ItemEditor";
import { inSection, kindOf, KINDS } from "./kinds";
import { Overview } from "./Overview";

const OVERVIEW = "Everything an agent gets in this project, what it costs in context before the first message, and how often it was used in the last 30 days.";
const NEW = "new";

const running = new Map<string | null, Promise<Customize>>();

function measureOnce(path: string | null) {
  const current = running.get(path);
  if (current) return current;
  const started = measureCustomize(path).finally(() => running.delete(path));
  running.set(path, started);
  return started;
}

function useCustomize(path: string | null) {
  const key = customizeKey(path);
  const [data, setData] = useState(() => cached<Customize>(key) ?? null);
  const [fresh, setFresh] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = (next: Customize) => {
    setData(remember(key, next));
    setFresh(true);
  };

  const measure = () => {
    setMeasuring(true);
    setError(null);
    return measureOnce(path)
      .then(store, (reason) => setError(String(reason)))
      .finally(() => setMeasuring(false));
  };

  const measureFirst = useEffectEvent(measure);
  const storeListed = useEffectEvent(store);

  useEffect(() => {
    listCustomize(path)
      .then((listed) => {
        storeListed(listed);
        if (!listed.measured) return measureFirst();
      })
      .catch((reason) => setError(String(reason)));
  }, [path]);

  const reload = () =>
    listCustomize(path).then(
      (next) => {
        store(next);
        return next;
      },
      (reason) => setError(String(reason)),
    );
  const updating = data !== null && !fresh && error === null;
  return { data, updating, measuring, error, measure, reload };
}

const UNGROUPED: CustomizeKind[] = ["plugin", "memory"];
const emptyText = (kind: CustomizeKind) => `No ${KINDS[kind].noun.toLowerCase()}s in this project.`;

type Reload = () => Promise<Customize | void>;

function KindView({ data, kind, reload }: { data: Customize; kind: CustomizeKind; reload: Reload }) {
  const editor = useItemEditor(data.project_path, reload);
  const items = inSection(data.items, KINDS[kind].section);
  const item = items.find((entry) => entry.id === editor.selected);
  const trailing = kind === "skill" ? (entry: CustomizeItem) => (entry.source === "factory" && entry.kind === "skill" ? <SkillSwitch name={entry.name} enabled={entry.enabled} onChanged={reload} /> : null) : undefined;
  return (
    <>
      <ItemBrowser
        items={items}
        selected={editor.selected}
        onSelect={editor.select}
        detail={editor.detail(item)}
        empty={emptyText(kind)}
        searchLabel={`Search ${KINDS[kind].noun.toLowerCase()}s`}
        columns={kind === "plugin" ? pluginColumns(data.project_path) : undefined}
        grouped={!UNGROUPED.includes(kind)}
        trailing={trailing}
        actions={canEdit(kind) && <NewMenu kind={kind} project={data.project_path} onNew={(scope) => editor.startNew(kind, scope)} />}
      />
      {editor.dialog}
    </>
  );
}

function AgentsView({ data, reload }: { data: Customize; reload: Reload }) {
  const [view, setView] = useState<"agents" | "defaults">("agents");
  const { roles, tools, error, reload: reloadRoles } = useRoles();
  const editor = useItemEditor(data.project_path, reload);
  const selected = editor.selected;
  const items = inSection(data.items, "agents");
  const item = items.find((entry) => entry.id === selected);
  const role = item?.source === "factory" ? roles.find((entry) => entry.name === item.name) : undefined;
  const taken = roles.map((entry) => entry.name);

  async function saved(name: string) {
    await Promise.all([reloadRoles(), reload()]);
    editor.select(`agent:factory::${name}`);
  }
  async function reset(name: string) {
    await resetRole(name);
    await Promise.all([reloadRoles(), reload()]);
  }

  const roleEditor = (target: typeof NEW_ROLE, isNew: boolean): Detail => ({
    label: isNew ? "New agent" : target.name,
    wide: true,
    content: <RoleEditor key={isNew ? NEW : target.name} role={target} isNew={isNew} tools={tools} taken={taken} onSaved={saved} onReset={reset} />,
  });
  const detail = selected === NEW ? roleEditor(NEW_ROLE, true) : role ? roleEditor(role, false) : editor.detail(item);

  return (
    <>
      <div className="flex items-center gap-3">
        <SegmentedGroup aria-label="Show agents or team defaults" value={[view]} onValueChange={([next]) => next && setView(next as typeof view)}>
          <ToggleGroupItem value="agents">Agents</ToggleGroupItem>
          <ToggleGroupItem value="defaults">Team defaults</ToggleGroupItem>
        </SegmentedGroup>
        {error && (
          <span role="alert" className="min-w-0 truncate text-label text-failed-ink">
            {error}
          </span>
        )}
        {view === "agents" && (
          <div className="ml-auto">
            <NewMenu kind="agent" project={data.project_path} extra={<DropdownMenuItem onClick={() => editor.select(NEW)}>Factory</DropdownMenuItem>} onNew={(scope) => editor.startNew("agent", scope)} />
          </div>
        )}
      </div>
      {view === "agents" ? (
        <ItemBrowser items={items} selected={selected} onSelect={editor.select} detail={detail} empty={emptyText("agent")} searchLabel="Search agents" grouped />
      ) : (
        <div data-scroll-inside className="min-h-0 max-w-[960px] overflow-y-auto">
          <TeamDefaults roles={roles} />
        </div>
      )}
      {editor.dialog}
    </>
  );
}

function MeasureButton({ measuring, onMeasure }: { measuring: boolean; onMeasure: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="sm" disabled={measuring} onClick={onMeasure} />}>
        <RefreshCw aria-hidden className={cn(measuring && "animate-spin")} />
        {measuring ? "Measuring…" : "Measure again"}
      </TooltipTrigger>
      <TooltipContent>Starts claude once in this project to count what it loads. Your SessionStart hooks run.</TooltipContent>
    </Tooltip>
  );
}

function CustomizeView({ section, project, onProject, onSection }: { section: SettingsSection; project: string; onProject: (path: string) => void; onSection: (section: SettingsSection) => void }) {
  const { data, updating, measuring, error, measure, reload } = useCustomize(project || null);
  const kind = kindOf(section);
  const { label } = SECTIONS.find((entry) => entry.id === section)!;
  const body = () => {
    if (!data) return <Skeleton className="h-40 w-full rounded-xl" />;
    if (!kind) return <Overview data={data} onSection={onSection} />;
    if (kind === "agent") return <AgentsView data={data} reload={reload} />;
    return <KindView data={data} kind={kind} reload={reload} />;
  };
  return (
    <Section
      title={label}
      description={kind ? KINDS[kind].description : OVERVIEW}
      fill
      aside={
        <>
          {updating && <span className="text-label text-faint">Updating…</span>}
          <ProjectPicker value={project} onChange={(path) => guardLeave(() => onProject(path))} label="Project:" optional />
          <MeasureButton measuring={measuring} onMeasure={measure} />
        </>
      }
    >
      {error && (
        <p role="alert" className="text-label text-failed-ink">
          {error}
        </p>
      )}
      {body()}
    </Section>
  );
}

type Props = { section: SettingsSection; project: string; onProject: (path: string) => void; onSection: (section: SettingsSection) => void };

export function CustomizePage({ section, project, onProject, onSection }: Props) {
  return <CustomizeView key={project} section={section} project={project} onProject={onProject} onSection={onSection} />;
}
