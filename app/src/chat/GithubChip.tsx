import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GithubLink } from "./github";

function GithubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={cn("size-3.5 shrink-0", className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const chip = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-accent-soft px-1.5 align-middle text-label font-medium text-accent-text";

export function GithubLinkChip({ link, className }: { link: GithubLink; className?: string }) {
  return (
    <a
      href={link.url}
      title={link.url}
      onClick={(event) => {
        event.preventDefault();
        openUrl(link.url).catch(() => undefined);
      }}
      className={cn(chip, "ui-focus transition-colors duration-(--duration-press) hover:bg-accent-soft/70", className)}
    >
      <GithubMark />
      <span className="truncate">{link.label}</span>
    </a>
  );
}

export function GithubChips({ links, onRemove }: { links: readonly GithubLink[]; onRemove: (url: string) => void }) {
  if (links.length === 0) return null;
  return (
    <ul aria-label="GitHub links" className="flex flex-wrap gap-1.5 px-3 pt-3">
      {links.map((link) => (
        <li key={link.url} className={cn(chip, "h-8 gap-1.5 pl-2")} title={link.url}>
          <GithubMark />
          <span className="truncate">{link.label}</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${link.label}`} onClick={() => onRemove(link.url)} className="mr-0.5">
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
