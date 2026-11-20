import { ChevronDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Account } from "@/ipc";
import { peakPercent } from "./format";

type Props = { accounts: Account[]; account: Account; onPick: (id: string) => void; forProject: boolean; onUseForProject: () => void };

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
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`Account ${account.label}${account.plan ? `, ${account.plan}` : ""}${peak === null ? "" : `, ${peak}% used`}`} className="max-w-56 text-muted" />}>
          <UserRound aria-hidden />
          <span className="truncate">{account.label}</span>
          {account.plan && <span className="text-faint">{account.plan}</span>}
          {peak !== null && <span className="tabular-nums text-faint">{peak}%</span>}
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          {accounts.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onPick(item.id)} aria-current={item.id === account.id}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">
                  {item.label}
                  {item.plan && <span className="font-normal text-faint"> · {item.plan}</span>}
                </span>
                <span className="flex flex-wrap gap-x-2 text-caption tabular-nums text-faint">
                  {item.limits.map((limit) => (
                    <span key={limit.kind}>
                      {limit.label} {Math.round(limit.percent)}%
                    </span>
                  ))}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
