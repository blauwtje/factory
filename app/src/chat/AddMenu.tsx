import { Plus } from "lucide-react";
import { PromptInputActionMenu, PromptInputActionMenuContent, PromptInputActionMenuItem, PromptInputActionMenuTrigger } from "@/components/ai/prompt-input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import type { SlashEntry, SlashGroup } from "./slash";

const SUBMENUS: { label: string; groups: SlashGroup[] }[] = [
  { label: "Skills", groups: ["Skills", "Commands"] },
  { label: "Agents", groups: ["Agents"] },
  { label: "Tools", groups: ["Tools"] },
];

type AddMenuProps = { entries: readonly SlashEntry[]; onAttach: () => void; onInsert: (text: string) => void };

export function AddMenu({ entries, onAttach, onInsert }: AddMenuProps) {
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger aria-label="Add">
        <Plus />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent align="start" side="top">
        <PromptInputActionMenuItem onClick={onAttach}>Add files</PromptInputActionMenuItem>
        {SUBMENUS.map(({ label, groups }) => {
          const members = entries.filter((entry) => groups.includes(entry.group));
          return (
            <DropdownMenuSub key={label}>
              <DropdownMenuSubTrigger disabled={members.length === 0}>{label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {members.map((entry) => (
                  <PromptInputActionMenuItem key={entry.id} onClick={() => onInsert(entry.insert)}>
                    <span className="shrink-0 font-medium text-ink">{entry.label}</span>
                    <span className="min-w-0 max-w-64 flex-1 truncate text-muted">{entry.description}</span>
                    {entry.plugin && <Badge variant="outline">{entry.plugin}</Badge>}
                  </PromptInputActionMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}
