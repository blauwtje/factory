import { open } from "@tauri-apps/plugin-dialog";
import { Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAccount, projectAccounts, refreshAccounts, removeAccount, renameAccount, setDefaultAccount, setProjectAccount, type Account } from "@/ipc";
import { usePref } from "@/lib/prefs";
import { cardClass } from "@/settings/parts";
import { ConfirmDialog } from "@/settings/ConfirmDialog";
import { resetTime, shownPercent, updatedAgo } from "./format";
import { LimitBar } from "./LimitBar";
import { usageTone } from "./tone";
import { useAccounts, useNow } from "./useAccounts";

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function AccountName({ account }: { account: Account }) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const label = draft?.trim();
    setDraft(null);
    if (label && label !== account.label) void renameAccount(account.id, label).catch((error) => toast.error("Could not rename the account", { description: String(error) }));
  }

  if (draft === null) {
    return (
      <button type="button" aria-label={`Rename ${account.label}`} onClick={() => setDraft(account.label)} className="ui-focus min-w-0 truncate rounded-sm text-left text-body font-medium text-ink hover:text-accent-text">
        {account.label}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      aria-label="Account name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
      className="h-7"
    />
  );
}

type FoldersProps = { account: Account; assigned: Record<string, string>; onChange: () => void };

function AccountFolders({ account, assigned, onChange }: FoldersProps) {
  const paths = Object.keys(assigned).filter((path) => assigned[path] === account.id);
  const move = (path: string, id: string | null) => void setProjectAccount(path, id).then(onChange);
  async function add() {
    const folder = await open({ directory: true });
    if (typeof folder === "string") move(folder, account.id);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-label font-medium text-muted">Folders</span>
        <Button type="button" variant="ghost" size="xs" aria-label={`Add a folder to ${account.label}`} onClick={() => void add()}>
          <Plus aria-hidden />
          Add folder
        </Button>
      </div>
      {paths.length === 0 ? (
        <p className="text-label text-faint">{account.is_default ? "Every folder without its own account." : "No folders use this account."}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {paths.map((path) => (
            <li key={path} className="flex items-center gap-2 rounded-md bg-active py-1 pl-2.5 pr-1 text-label text-ink">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{path}</span>
                <span className="text-caption text-faint">and every folder inside it</span>
              </span>
              <button type="button" aria-label={`Remove ${basename(path)} from ${account.label}`} onClick={() => move(path, null)} className="ui-focus grid size-5 shrink-0 place-items-center rounded-full text-muted hover:text-ink">
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountCard({ account, now, ...projects }: { account: Account; now: number } & Omit<FoldersProps, "account">) {
  const [mode] = usePref("usageMode", "used");
  const remaining = mode === "remaining";
  return (
    <section aria-label={account.label} className={`${cardClass} flex flex-col gap-4`}>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <AccountName account={account} />
          {account.plan && <Badge variant="outline">{account.plan}</Badge>}
          {account.is_default ? (
            <Badge>Default</Badge>
          ) : (
            <Button type="button" variant="outline" size="xs" aria-label={`Set as default, ${account.label}`} onClick={() => void setDefaultAccount(account.id)}>
              Set as default
            </Button>
          )}
        </div>
        {account.email && <span className="truncate text-label text-muted">{account.email}</span>}
      </header>
      <div className="flex flex-col gap-3">
        {account.limits.map((limit) => (
          <div key={limit.kind} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1">
            <span className="text-body text-ink">{limit.label}</span>
            <span className={`text-body tabular-nums ${usageTone(limit.percent).text}`}>
              {Math.round(shownPercent(limit, remaining))}% <span className="text-label text-muted">{remaining ? "left" : "used"}</span>
            </span>
            <LimitBar percent={limit.percent} shown={shownPercent(limit, remaining)} className="col-span-2" />
            {limit.resets_at !== null && <span className="col-span-2 text-caption text-faint">Resets {resetTime(limit.resets_at)}</span>}
          </div>
        ))}
        {account.limits.length === 0 && <p className="text-label text-faint">{account.refreshing ? "Loading limits" : "No limits reported yet."}</p>}
      </div>
      {account.error && (
        <p role="alert" className="text-label text-failed-ink">
          {account.error}
        </p>
      )}
      <AccountFolders account={account} {...projects} />
      <footer className="mt-auto flex items-center gap-1.5 border-t border-rule pt-3">
        <span className="flex-1 text-caption text-faint">{updatedAgo(account.updated_at, now)}</span>
        <Button type="button" variant="ghost" size="sm" disabled={account.refreshing} aria-label={`Refresh ${account.label}`} onClick={() => void refreshAccounts()}>
          {account.refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          Refresh
        </Button>
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${account.label}`}>
              <Trash2 aria-hidden />
            </Button>
          }
          title={`Remove ${account.label}?`}
          description="Factory stops using this account. Its sign-in and files stay where they are."
          action="Remove"
          onConfirm={() => void removeAccount(account.id)}
        />
      </footer>
    </section>
  );
}

export function UsagePage() {
  const accounts = useAccounts();
  const now = useNow();
  const [assigned, setAssigned] = useState<Record<string, string>>({});

  const reload = () => void projectAccounts().then((map) => setAssigned(map ?? {}));

  useEffect(() => {
    reload();
  }, []);

  async function add() {
    const folder = await open({ directory: true });
    if (!folder) return;
    await addAccount(folder).catch((error) => toast.error("Could not add the account", { description: String(error) }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        {accounts?.map((account) => <AccountCard key={account.id} account={account} now={now} assigned={assigned} onChange={reload} />)}
      </div>
      <div>
        <Button type="button" variant="outline" onClick={() => void add()}>
          <Plus aria-hidden />
          Add account
        </Button>
      </div>
    </div>
  );
}
