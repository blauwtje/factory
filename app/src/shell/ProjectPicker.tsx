import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { listProjects, type RecentProject } from "@/ipc";
import { ProjectAvatar } from "./brand";

type Props = { value: string; onChange: (path: string) => void; label?: string; optional?: boolean };

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function ProjectPicker({ value, onChange, label = "Start in", optional = false }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const name = recent.find((project) => project.path === value)?.name ?? (value ? basename(value) : optional ? "All" : "Choose a project");

  useEffect(() => {
    void listProjects().then(setRecent);
  }, [value]);

  async function openFolder() {
    const folder = await open({ directory: true });
    if (folder) onChange(folder);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" aria-label={`${label} ${value ? name : optional ? "all" : "project"}`} className="h-8 gap-2 rounded-lg border border-edge bg-raised/60 px-2 text-heading font-medium text-ink" />}
      >
        {value ? <ProjectAvatar name={name} className="size-5 rounded-md" /> : <Folder className="size-4 text-muted" aria-hidden />}
        {name}
        <ChevronDown className="size-4 text-faint" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        {recent.length > 0 && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent</DropdownMenuLabel>
              {recent.map((project) => (
                <DropdownMenuItem key={project.path} onClick={() => onChange(project.path)}>
                  <ProjectAvatar name={project.name} className="size-6 rounded-md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="truncate font-mono text-caption text-faint">{project.path}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {optional && (
          <DropdownMenuItem onClick={() => onChange("")}>
            <Folder className="size-4 text-muted" aria-hidden />
            All
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={openFolder}>
          <FolderOpen className="size-4 text-muted" aria-hidden />
          Open folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
