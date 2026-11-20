import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePref, type SessionGroup, type SessionSort, type SessionWindow } from "@/lib/prefs";

const GROUPS: { value: SessionGroup; label: string }[] = [
  { value: "none", label: "None" },
  { value: "project", label: "Project" },
  { value: "status", label: "Status" },
];

const SORTS: { value: SessionSort; label: string }[] = [
  { value: "started", label: "Recently started" },
  { value: "active", label: "Recently active" },
  { value: "needs_reply", label: "Needs reply first" },
];

const WINDOWS: { value: SessionWindow; label: string }[] = [
  { value: 1, label: "Last day" },
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 0, label: "All" },
];

export function ViewOptions() {
  const [group, setGroup] = usePref("sessionGroup", "project");
  const [sort, setSort] = usePref("sessionSort", "active");
  const [days, setDays] = usePref("sessionWindow", 0);
  const [archived, setArchived] = usePref("showArchived", false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="View options" />}>
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={group} onValueChange={(value) => setGroup(value as SessionGroup)}>
            {GROUPS.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(value as SessionSort)}>
            {SORTS.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={days} onValueChange={(value) => setDays(value as SessionWindow)}>
            {WINDOWS.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={archived} onCheckedChange={setArchived}>
          Show archived
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
