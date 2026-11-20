import { Fragment } from "react";
import { ExternalLink, FolderOpen, GitBranch } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyButton } from "@/components/ai/code-block";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { openWorktree } from "@/ipc";

function BreakablePath({ text }: { text: string }) {
  const parts = text.split("/");
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}

type Props = { branch: string; worktree: string; agentId: string; branchUrl?: string | null };

export function BranchChip({ branch, worktree, agentId, branchUrl }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Branch ${branch}`}
        className="ui-press flex h-7 max-w-48 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-label text-muted ui-focus transition-colors duration-(--duration-press) hover:text-ink"
      >
        <GitBranch aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{branch}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <section className="flex flex-col gap-1">
          <p className="text-label font-medium text-ink">Branch</p>
          {branchUrl ? (
            <button type="button" onClick={() => void openUrl(branchUrl).catch(() => undefined)} className="ui-press w-fit max-w-full break-words cursor-pointer text-left font-mono text-label text-accent-text ui-focus underline-offset-4 hover:underline">
              <BreakablePath text={branch} />
            </button>
          ) : (
            <>
              <p className="break-words font-mono text-label text-muted">
                <BreakablePath text={branch} />
              </p>
              <p className="text-caption text-faint">Not pushed to GitHub</p>
            </>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <p className="text-label font-medium text-ink">Worktree</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void openWorktree(agentId).catch(() => undefined)} className="ui-press min-w-0 flex-1 break-words cursor-pointer text-left font-mono text-label text-accent-text ui-focus underline-offset-4 hover:underline">
              <BreakablePath text={worktree} />
            </button>
            <CopyButton text={worktree} label="Copy worktree path" />
          </div>
        </section>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void openWorktree(agentId).catch(() => undefined)}>
            <FolderOpen aria-hidden />
            Open folder
          </Button>
          {branchUrl && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void openUrl(branchUrl).catch(() => undefined)}>
              <ExternalLink aria-hidden />
              Open on GitHub
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
