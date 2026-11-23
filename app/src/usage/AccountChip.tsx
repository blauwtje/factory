import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Account } from "@/ipc";
import { cn } from "@/lib/utils";
import { peakPercent } from "./format";
import { LimitBar } from "./LimitBar";
import { usageTone } from "./tone";

type Props = { accounts: Account[]; account: Account; onPick: (id: string) => void; forProject: boolean; onUseForProject: () => void };

const shortName = (label: string) => label.split("@")[0];

function Initial({ label, className }: { label: string; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold uppercase leading-none text-accent-text", className)}>
      {label.charAt(0)}
    </span>
  );
}

export function AccountChip({ accounts, account, onPick, forProject, onUseForProject }: Props) {
  const peak = peakPercent(account);
  return (
    <>
      {forProject && (
        <Button type="button" variant="ghost" size="xs" onClick={onUseForProject}>
          Use for this project
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`Account ${account.label}${account.plan ? `, ${account.plan}` : ""}${peak === null ? "" : `, ${peak}% used`}`} className={cn(chipClass, "max-w-52 pl-1.5")} />}>
          <Initial label={account.label} />
          <span className="truncate">{shortName(account.label)}</span>
          {peak !== null && (
            <span className="flex items-center gap-1">
              <LimitBar percent={peak} className="w-5" />
              <span className={cn("tabular-nums", peak >= 80 ? usageTone(peak).text : "text-muted")}>{peak}%</span>
            </span>
          )}
          <ChevronDown aria-hidden className="size-3 text-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-72 p-1.5">
          <p className="ui-overline px-2 pb-1 pt-1 text-faint">Account</p>
          {accounts.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onPick(item.id)} aria-current={item.id === account.id} className="items-start gap-2.5 py-2">
              <Initial label={item.label} className="mt-0.5 size-6 text-caption" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-medium text-ink">{item.label}</span>
                  {item.plan && <span className="shrink-0 text-label text-faint">{item.plan}</span>}
                </span>
                {item.limits.map((limit) => (
                  <span key={limit.kind} className="grid grid-cols-[4.5rem_1fr_2.25rem] items-center gap-2 text-caption text-muted">
                    <span className="truncate">{limit.label}</span>
                    <LimitBar percent={limit.percent} />
                    <span className={cn("text-right tabular-nums", usageTone(limit.percent).text)}>{Math.round(limit.percent)}%</span>
                  </span>
                ))}
              </span>
              <Check aria-hidden className={cn("mt-1 size-4 text-accent-text!", item.id !== account.id && "invisible")} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
