import { Blocks, Bot, Brain, ChartColumn, Gauge, Info, LayoutDashboard, MessagesSquare, Puzzle, ScrollText, Server, ShieldCheck, SlidersHorizontal, SquarePen, SquareTerminal, Webhook, type LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NavList, SidebarHeader } from "./Sidebar";
import type { SettingsSection } from "./types";

export type SectionGroup = "settings" | "customize";

export const NAV_LABELS: Record<SectionGroup, string> = { settings: "Settings", customize: "Customize" };

export const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon; group: SectionGroup }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal, group: "settings" },
  { id: "sessions", label: "Sessions", icon: MessagesSquare, group: "settings" },
  { id: "permissions", label: "Permission log", icon: ShieldCheck, group: "settings" },
  { id: "usage", label: "Usage", icon: Gauge, group: "settings" },
  { id: "statistics", label: "Statistics", icon: ChartColumn, group: "settings" },
  { id: "cli", label: "Claude CLI", icon: SquareTerminal, group: "settings" },
  { id: "about", label: "About", icon: Info, group: "settings" },
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "customize" },
  { id: "plugins", label: "Plugins", icon: Puzzle, group: "customize" },
  { id: "skills", label: "Skills", icon: Blocks, group: "customize" },
  { id: "agents", label: "Agents", icon: Bot, group: "customize" },
  { id: "mcp", label: "MCP servers", icon: Server, group: "customize" },
  { id: "hooks", label: "Hooks", icon: Webhook, group: "customize" },
  { id: "rules", label: "Rules", icon: ScrollText, group: "customize" },
  { id: "memory", label: "Memory", icon: Brain, group: "customize" },
];

type Props = {
  group: SectionGroup;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onNew: (event: MouseEvent<HTMLButtonElement>) => void;
  onCollapse: () => void;
};

export function SettingsNav({ group, section, onSection, onNew, onCollapse }: Props) {
  const actions = SECTIONS.filter((entry) => entry.group === group).map(({ id, label, icon }) => ({ label, icon, onClick: () => onSection(id), active: id === section }));
  return (
    <aside className="flex h-full min-w-60 flex-col">
      <SidebarHeader onCollapse={onCollapse} />
      <ScrollArea className="flex-1">
        <nav aria-label={NAV_LABELS[group]} className="flex flex-col">
          <NavList actions={[{ label: "New", icon: SquarePen, onClick: onNew }, ...actions]} />
        </nav>
      </ScrollArea>
    </aside>
  );
}
