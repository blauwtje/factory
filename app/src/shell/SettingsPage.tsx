import { getVersion } from "@tauri-apps/api/app";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ModelMenu } from "@/components/ai/model-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup as SegmentedGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { claudeInfo, type ClaudeInfo } from "@/ipc";
import { isMac } from "@/lib/platform";
import { usePref, type Theme, type UsageMode } from "@/lib/prefs";
import { PALETTES, useScheme, type Palette } from "@/lib/theme";
import { useLeadItems } from "@/new-job/lead";
import { cn } from "@/lib/utils";
import { UpdateRows } from "@/update/UpdateRows";
import { PermissionLog } from "@/settings/PermissionLog";
import { StatsTab } from "@/stats/StatsTab";
import { UsagePage } from "@/usage/UsagePage";
import { cardClass, Panel, Row, Rows, Section, SettingRow } from "@/settings/parts";
import { Mark } from "./brand";
import type { SettingsSection } from "./types";

export type ClaudeResult = { info: ClaudeInfo } | { error: string };

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function SchemePreview({ scheme, palette, className }: { scheme: "light" | "dark"; palette: Palette; className?: string }) {
  return (
    <span data-palette={palette} className={cn(scheme === "light" ? "scheme-light" : "scheme-dark", "absolute inset-0 flex gap-1 bg-frame p-1.5", className)}>
      <span className="w-6 shrink-0 rounded-xs bg-edge/70" />
      <span className="flex flex-1 flex-col gap-1.5 rounded-xs bg-surface p-1.5 shadow-[0_0_0_1px_var(--edge)]">
        <span className="h-1 w-2/3 rounded-full bg-ink/70" />
        <span className="h-1 w-1/2 rounded-full bg-muted/60" />
        <span className="mt-auto h-2 w-6 self-end rounded-xs bg-accent" />
      </span>
    </span>
  );
}

function ThemeChoice() {
  const [theme, setTheme] = usePref("theme", "system");
  const [palette] = usePref("palette", "graphite");
  return (
    <ToggleGroup
      aria-label="Theme"
      value={[theme]}
      onValueChange={(values: Theme[]) => values[0] && setTheme(values[0])}
      className="grid grid-cols-5 gap-3"
    >
      {THEMES.map(({ id, label }) => (
        <Toggle key={id} value={id} className="group flex w-full flex-col items-start gap-2 rounded-md text-left ui-focus">
          <span
            aria-hidden
            className="relative aspect-[8/5] w-full overflow-hidden rounded-md shadow-card outline-2 outline-offset-0 outline-transparent transition-[box-shadow,outline-color,outline-offset] duration-(--duration-press) ease-(--ease-out) group-hover:shadow-lift group-data-[pressed]:outline-offset-2 group-data-[pressed]:outline-accent"
          >
            <SchemePreview scheme={id === "dark" ? "dark" : "light"} palette={palette} />
            {id === "system" && <SchemePreview scheme="dark" palette={palette} className="[clip-path:inset(0_0_0_50%)]" />}
          </span>
          <span className="text-label text-muted group-data-[pressed]:font-medium group-data-[pressed]:text-ink">{label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function PaletteChoice() {
  const [palette, setPalette] = usePref("palette", "graphite");
  const scheme = useScheme();
  return (
    <ToggleGroup
      aria-label="Color"
      value={[palette]}
      onValueChange={(values: Palette[]) => values[0] && setPalette(values[0])}
      className="grid grid-cols-5 gap-3"
    >
      {PALETTES.map(({ id, label }) => (
        <Toggle key={id} value={id} className="group flex w-full flex-col items-start gap-2 rounded-md text-left ui-focus">
          <span
            aria-hidden
            className="relative aspect-[8/5] w-full overflow-hidden rounded-md shadow-card outline-2 outline-offset-0 outline-transparent transition-[box-shadow,outline-color,outline-offset] duration-(--duration-press) ease-(--ease-out) group-hover:shadow-lift group-data-[pressed]:outline-offset-2 group-data-[pressed]:outline-accent"
          >
            <SchemePreview scheme={scheme} palette={id} />
          </span>
          <span className="text-label text-muted group-data-[pressed]:font-medium group-data-[pressed]:text-ink">{label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function PrefSwitch({ prefKey, label }: { prefKey: "confirmMerge" | "showUsage"; label: string }) {
  const [on, setOn] = usePref(prefKey, true);
  return <Switch aria-label={label} checked={on} onCheckedChange={setOn} />;
}

function UsageModeChoice() {
  const [mode, setMode] = usePref("usageMode", "used");
  return (
    <SegmentedGroup aria-label="Show used or remaining" value={[mode]} onValueChange={([next]) => next && setMode(next as UsageMode)}>
      <ToggleGroupItem value="used">Used</ToggleGroupItem>
      <ToggleGroupItem value="remaining">Remaining</ToggleGroupItem>
    </SegmentedGroup>
  );
}

function SessionsRows() {
  const [model, setModel] = usePref("leadModel", "");
  const [effort, setEffort] = usePref("leadEffort", "");
  const [confirmMerge] = usePref("confirmMerge", true);
  const { models, efforts } = useLeadItems();
  return (
    <>
      <Panel title="New sessions">
        <SettingRow label="Default model" description="The model and effort the Orchestrator of a new session starts on." value={`${model} ${effort}`}>
          <ModelMenu
            header="Orchestrator"
            model={model}
            effort={effort}
            models={models}
            efforts={efforts}
            onChange={(next) => {
              setModel(next.model);
              setEffort(next.effort);
            }}
          />
        </SettingRow>
      </Panel>
      <Panel title="Merging">
        <SettingRow label="Ask before merging" description="Show a confirmation before a session's changes are merged." value={confirmMerge}>
          <PrefSwitch prefKey="confirmMerge" label="Ask before merging" />
        </SettingRow>
      </Panel>
    </>
  );
}

function UsageRows() {
  const [showUsage] = usePref("showUsage", true);
  const [mode] = usePref("usageMode", "used");
  return (
    <Panel title="Sidebar">
      <div className="divide-y divide-rule">
        <SettingRow label="Show limits in the sidebar" description="The limits of the selected session's Claude account." value={showUsage}>
          <PrefSwitch prefKey="showUsage" label="Show limits in the sidebar" />
        </SettingRow>
        <SettingRow label="Show used or remaining" description="Count up what you have used, or down what is left." value={mode}>
          <UsageModeChoice />
        </SettingRow>
      </div>
    </Panel>
  );
}

function CheckAgain({ onResult }: { onResult: (result: ClaudeResult) => void }) {
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const result = await claudeInfo().then(
      (info): ClaudeResult => ({ info }),
      (reason): ClaudeResult => ({ error: String(reason) }),
    );
    setChecking(false);
    onResult(result);
  };
  return (
    <Button variant="outline" size="sm" disabled={checking} onClick={check}>
      <RefreshCw aria-hidden className={cn(checking && "animate-spin")} />
      Check again
    </Button>
  );
}

function ClaudeRows({ claude, onResult }: { claude: ClaudeResult; onResult: (result: ClaudeResult) => void }) {
  if ("error" in claude) {
    return (
      <Panel title="Installation">
        <Rows>
          <Row label="Status">
            <span className="text-right text-failed-ink">{claude.error}</span>
            <CheckAgain onResult={onResult} />
          </Row>
        </Rows>
      </Panel>
    );
  }
  const { info } = claude;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn(cardClass, "flex flex-col gap-2")}>
          <span className="text-label text-muted">Status</span>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="done" className="h-6 px-2 text-label">
              Installed
            </Badge>
            <CheckAgain onResult={onResult} />
          </div>
        </div>
        <div className={cn(cardClass, "flex flex-col gap-2")}>
          <span className="text-label text-muted">Version</span>
          <span className="font-mono text-title tabular-nums text-ink">{info.version}</span>
        </div>
      </div>
      <Panel title="Location">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="min-w-0 flex-1 break-all rounded-lg border border-edge bg-surface px-3 py-2 font-mono text-note text-ink">{info.path}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy path"
                  onClick={async () => {
                    await navigator.clipboard.writeText(info.path);
                    toast.success("Copied path");
                  }}
                />
              }
            >
              <Copy />
            </TooltipTrigger>
            <TooltipContent>Copy path</TooltipContent>
          </Tooltip>
        </div>
      </Panel>
      <Panel title="Used for">
        <Rows>
          <Row label="Every agent">
            <span className="text-muted">Starts claude in its own worktree</span>
          </Row>
          <Row label="Statistics">
            <span className="text-muted">Reads the conversations claude saves</span>
          </Row>
        </Rows>
      </Panel>
    </>
  );
}

function AboutRows({ claude }: { claude: ClaudeResult }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null));
  }, []);

  return (
    <>
      <div className={cn(cardClass, "flex items-center gap-4")}>
        <Mark className="size-12 rounded-xl" />
        <div className="flex flex-col gap-0.5">
          <span className="text-heading font-semibold text-ink">Factory</span>
          {version && <span className="font-mono text-label text-muted">Version {version}</span>}
        </div>
      </div>
      <UpdateRows version={version} />
      <Panel title="Details">
        <Rows>
          {"info" in claude && (
            <Row label="Claude CLI">
              <span className="font-mono text-label">{claude.info.version}</span>
            </Row>
          )}
          <Row label="Built with">
            <span className="font-mono text-label">Tauri, React</span>
          </Row>
          <Row label="Claude conversations">
            <span className="font-mono text-label">~/.claude/projects</span>
          </Row>
          <Row label="Where sessions run">
            <span className="text-muted">Each in its own git worktree</span>
          </Row>
          <Row label="Licenses">
            <span className="text-muted">Listed in THIRD-PARTY-NOTICES.md, shipped with the app</span>
          </Row>
        </Rows>
      </Panel>
    </>
  );
}

function Content({ section, claude, onResult }: { section: SettingsSection; claude: ClaudeResult; onResult: (result: ClaudeResult) => void }) {
  if (section === "general") {
    return (
      <Section title="General" description="How Factory looks.">
        <Panel title="Appearance">
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex flex-col gap-2">
              <ThemeChoice />
              <span className="text-label text-muted">System follows the {isMac ? "macOS" : "Windows"} light or dark setting</span>
            </div>
            <span className="text-label font-medium text-muted">Color</span>
            <PaletteChoice />
          </div>
        </Panel>
      </Section>
    );
  }
  if (section === "sessions") {
    return (
      <Section title="Sessions" description="Defaults for new sessions and what happens when they finish.">
        <SessionsRows />
      </Section>
    );
  }
  if (section === "permissions") {
    return (
      <Section title="Permission log" description="Every permission you answered, per project. Kept on this computer only.">
        <PermissionLog />
      </Section>
    );
  }
  if (section === "usage") {
    return (
      <Section title="Usage" description="The limits of your Claude accounts and which projects use which." wide>
        <UsagePage />
        <UsageRows />
      </Section>
    );
  }
  if (section === "statistics") return <StatisticsSection />;
  if (section === "cli") {
    return (
      <Section title="Claude CLI" description="The command line tool every session runs through.">
        <ClaudeRows claude={claude} onResult={onResult} />
      </Section>
    );
  }
  if (section === "about") {
    return (
      <Section title="About" description="Factory runs Claude Code sessions in their own git worktrees.">
        <AboutRows claude={claude} />
      </Section>
    );
  }
  return null;
}

let statsProject = "";

function StatisticsSection() {
  const [project, setProject] = useState(statsProject);
  const pick = (path: string) => {
    statsProject = path;
    setProject(path);
  };
  return <StatsTab key={project} project={project} onProject={pick} />;
}

export function SettingsPage({ claude, section }: { claude: ClaudeResult; section: SettingsSection }) {
  const [rechecked, setRechecked] = useState<ClaudeResult | null>(null);
  return (
    <div key={section} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className={cn("w-full px-8", section === "statistics" ? "pb-6 pt-6" : "pb-12 pt-10")}>
        <Content section={section} claude={rechecked ?? claude} onResult={setRechecked} />
      </div>
    </div>
  );
}
