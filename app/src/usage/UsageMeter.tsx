import NumberFlow from "@number-flow/react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { duration, ease } from "@/lib/motion";
import { usePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { resetIn, resetText, resetTime, shownPercent } from "./format";
import { LimitBar } from "./LimitBar";
import { usageTone } from "./tone";
import { accountFor, useAccounts, useNow } from "./useAccounts";

const PERCENT = { style: "percent", maximumFractionDigits: 0 } as const;

const EASE_OUT = `cubic-bezier(${ease.out.join(", ")})`;

const FLOW = {
  transformTiming: { duration: duration.panel * 1000, easing: EASE_OUT },
  spinTiming: { duration: duration.panel * 1000, easing: EASE_OUT },
  opacityTiming: { duration: duration.press * 1000, easing: EASE_OUT },
};

export function UsageMeter({ onOpen, accountId }: { onOpen?: () => void; accountId?: string | null }) {
  const accounts = useAccounts();
  const [showUsage] = usePref("showUsage", true);
  const [mode] = usePref("usageMode", "used");
  const [enters] = useState(() => accounts === null);
  const now = useNow(1_000);
  const account = accounts && accountFor(accounts, accountId);

  if (!showUsage) return null;
  if (accounts === null) return <Skeleton className="mx-2.5 mb-5 mt-2 h-14" />;
  const title = account ? [account.label, account.plan].filter(Boolean).join(" · ") : "Claude";
  if (!account || account.limits.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Claude usage unavailable${account ? `, ${title}` : ""}`}
              onClick={onOpen}
              className="ui-press flex h-14 w-full flex-col gap-2 rounded-lg px-2.5 pb-5 pt-2 text-left ui-focus"
            />
          }
        >
          <span className="truncate text-caption text-faint">{title}</span>
          <span className="text-label text-muted">Usage unavailable</span>
        </TooltipTrigger>
        <TooltipContent side="right" align="end">
          {account?.error ?? "No usage reported yet"}
        </TooltipContent>
      </Tooltip>
    );
  }
  const remaining = mode === "remaining";
  const word = remaining ? "left" : "used";
  const name = [
    `Claude usage, ${title}`,
    ...account.limits.map((limit) => {
      const { level } = usageTone(limit.percent);
      return `${limit.label} ${Math.round(shownPercent(limit, remaining))}% ${word}${level === "normal" ? "" : ` (${level})`}${limit.resets_at === null ? "" : `, resets ${resetTime(limit.resets_at)}`}`;
    }),
  ].join(", ");

  return (
    <motion.div
      initial={enters ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.panel, ease: ease.out }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={name}
              onClick={onOpen}
              className="ui-press flex w-full flex-col gap-2 rounded-lg px-2.5 pb-5 pt-2 text-left ui-focus"
            />
          }
        >
          <span className="flex items-center justify-between gap-2 text-caption text-faint">
            <span className="truncate">{title}</span>
            {account.refreshing && <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />}
          </span>
          {account.limits.map((limit) => (
            <span key={limit.kind} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-1">
              <span className="truncate text-label text-muted">{limit.label}</span>
              <NumberFlow
                {...FLOW}
                className={cn("text-label tabular-nums [--number-flow-mask-height:0.15em] transition-colors duration-(--duration-panel) ease-out", usageTone(limit.percent).text)}
                value={shownPercent(limit, remaining) / 100}
                format={PERCENT}
              />
              <LimitBar percent={limit.percent} shown={shownPercent(limit, remaining)} className="col-span-2" />
              {limit.resets_at !== null && <span className="col-span-2 text-caption tabular-nums text-faint">Resets in {resetIn(limit.resets_at, now)}</span>}
            </span>
          ))}
        </TooltipTrigger>
        <TooltipContent side="right" align="end" className="flex-col items-start gap-0.5">
          {account.limits.map((limit) => (
            <span key={limit.kind}>{resetText(limit)}</span>
          ))}
          <span className="text-surface/70">Open usage</span>
        </TooltipContent>
      </Tooltip>
    </motion.div>
  );
}
