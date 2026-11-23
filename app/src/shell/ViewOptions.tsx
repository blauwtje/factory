import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePref, type SessionGroup, type SessionSort, type SessionWindow } from "@/lib/prefs";

const GROUPS: { value: SessionGroup; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "status", label: "Status" },
  { value: "none", label: "None" },
];

const SORTS: { value: SessionSort; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "started", label: "Started" },
  { value: "needs_reply", label: "Needs reply" },
];

const WINDOWS: { value: SessionWindow; label: string }[] = [
  { value: 1, label: "1d" },
  { value: 3, label: "3d" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 0, label: "All" },
];

function Choice<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted">{label}</span>
      <ToggleGroup aria-label={label} size="sm" value={[String(value)]} onValueChange={([next]) => next !== undefined && onChange(options.find((option) => String(option.value) === next)!.value)} className="w-full">
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={String(option.value)} className="flex-1">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function ViewOptions() {
  const [group, setGroup] = usePref("sessionGroup", "project");
  const [sort, setSort] = usePref("sessionSort", "active");
  const [days, setDays] = usePref("sessionWindow", 0);
  const [archived, setArchived] = usePref("showArchived", false);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="View options" />}>
        <SlidersHorizontal />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3">
        <Choice label="Group by" options={GROUPS} value={group} onChange={setGroup} />
        <Choice label="Sort by" options={SORTS} value={sort} onChange={setSort} />
        <Choice label="Show sessions from" options={WINDOWS} value={days} onChange={setDays} />
        <label className="flex items-center justify-between gap-3 border-t border-rule pt-3 text-label text-ink">
          Show archived
          <Switch checked={archived} onCheckedChange={setArchived} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
