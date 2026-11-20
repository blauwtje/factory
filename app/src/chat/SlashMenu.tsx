import { motion } from "motion/react";
import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { listCustomize } from "@/ipc";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { completeSlash, filterSlash, GROUPS, openSlash, slashEntries, BUILT_IN, type SlashEntry } from "./slash";

const MENU_ID = "slash-menu";
const optionId = (entry: SlashEntry) => `slash-option-${entry.id}`;

export function useSlashMenu(
  draft: string,
  setDraft: (text: string) => void,
  textarea: RefObject<HTMLTextAreaElement | null>,
  project: string | null,
) {
  const [entries, setEntries] = useState<SlashEntry[]>(BUILT_IN);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => listCustomize(project))
      .then(({ items }) => current && setEntries(slashEntries(items)))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [project]);

  const slash = openSlash(draft, cursor);
  const matches = slash && dismissed !== draft ? filterSlash(entries, slash.query) : [];
  const open = slash !== null && matches.length > 0;
  const selected = Math.min(active, Math.max(matches.length - 1, 0));

  function pick(entry: SlashEntry) {
    if (!slash) return;
    const next = completeSlash(draft, slash.start, cursor, entry.insert);
    setDraft(next.text);
    setCursor(next.cursor);
    requestAnimationFrame(() => textarea.current?.setSelectionRange(next.cursor, next.cursor));
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((selected + step + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(matches[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(draft);
    }
  }

  return {
    open,
    entries,
    matches,
    selected,
    pick,
    keyDown,
    track: (element: HTMLTextAreaElement) => {
      setCursor(element.selectionStart);
      setActive(0);
    },
    textareaProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? MENU_ID : undefined,
      "aria-activedescendant": open ? optionId(matches[selected]) : undefined,
    },
  };
}

type SlashMenuProps = { matches: SlashEntry[]; selected: number; onPick: (entry: SlashEntry) => void };

export function SlashMenu({ matches, selected, onPick }: SlashMenuProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.menu, ease: ease.out }}
      className="absolute inset-x-0 bottom-full z-50 mb-2 max-h-72 overflow-y-auto rounded-xl bg-overlay p-1 shadow-popover"
    >
      <div id={MENU_ID} role="listbox" aria-label="Skills, commands, agents and tools">
        {GROUPS.map((group) => {
          const members = matches.filter((entry) => entry.group === group);
          if (members.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={group}>
              <div aria-hidden className="ui-overline px-2 pb-1 pt-1.5 text-faint">
                {group}
              </div>
              {members.map((entry) => (
                <div
                  key={entry.id}
                  id={optionId(entry)}
                  role="option"
                  aria-selected={entry === matches[selected]}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(entry);
                  }}
                  className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-body", entry === matches[selected] && "bg-active")}
                >
                  <span className="shrink-0 font-medium text-ink">{entry.label}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{entry.description}</span>
                  {entry.plugin && <Badge variant="outline">{entry.plugin}</Badge>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
