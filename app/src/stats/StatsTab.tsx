import NumberFlow from "@number-flow/react";
import { ChartColumn } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { claudeStats, claudeStatsSnapshot, onStatsProgress, type Progress, type Stats, type Tokens } from "@/ipc";
import { readPersisted, writePersisted } from "@/lib/persisted";
import { ProjectPicker } from "@/shell/ProjectPicker";
import { Heatmap } from "./Heatmap";
import { CountFlow, DayStrip, FLOW, KpiCard, Sparkline, TokenFlow } from "./Kpi";
import { ModelChart } from "./ModelChart";
import { ProjectList } from "./ProjectList";
import { cardClass, longDate, Panel, shortDate } from "./Panel";
import { change, period, RANGES, type RangeKey } from "./range";
import { cacheHitRatio, count, dayOf, groupByWeekHour, MS_PER_HOUR, sumTokens } from "./format";
import { TokenMix } from "./TokenMix";
import { TokensChart } from "./TokensChart";
import "./stats.css";

type Load = { kind: "loading" } | { kind: "empty" } | { kind: "failed"; message: string } | { kind: "ready"; stats: Stats; fresh: boolean };

const ROW = "grid gap-3 @2xl:grid-cols-2 @3xl:grid-cols-4";

const SNAPSHOT_INTERVAL_MS = 2000;

const RANGE_TITLES: Record<RangeKey, string> = { "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };

const breakdown = (tokens: Tokens) =>
  `${count(tokens.uncached)} new tokens, without cache reads: ${count(tokens.input)} input, ${count(tokens.cache_write)} cache write, ${count(tokens.output)} output. ${count(tokens.cache_read)} cache read, not counted.`;

function ProgressBar({ progress }: { progress: Progress }) {
  const fraction = progress.files_total ? progress.files_done / progress.files_total : 0;
  return (
    <div className={cn("flex flex-col gap-2.5", cardClass)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label font-medium text-ink">Reading your Claude conversations</span>
        <span className="flex items-baseline gap-2 text-label text-faint">
          {count(progress.files_done)} of {count(progress.files_total)} files
          <NumberFlow {...FLOW} className="font-mono text-label font-medium text-ink" value={fraction} format={{ style: "percent", maximumFractionDigits: 0 }} locales="en-US" />
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Indexing progress"
        aria-valuemin={0}
        aria-valuemax={progress.files_total}
        aria-valuenow={progress.files_done}
        className="h-2 overflow-hidden rounded-full bg-active"
      >
        <div className="stats-progress-fill h-full" style={{ "--fraction": fraction } as CSSProperties} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="stats-rise flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge px-6 py-14 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-text">
        <ChartColumn aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="text-balance text-title font-medium text-ink">No usage yet</p>
        <p className="max-w-prose text-pretty text-body text-muted">Statistics appear here once you use Claude Code on this computer.</p>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading statistics</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div role="alert" className={cn("flex flex-col gap-1", cardClass)}>
      <p className="text-body font-medium text-failed-ink">Could not read statistics</p>
      <p className="break-words text-label text-muted">{message}</p>
    </div>
  );
}

function SectionHeader({ title, children, detail, aside }: { title: string; children?: ReactNode; detail?: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h3 className="text-title font-medium text-ink">{title}</h3>
        {children && (
          <span title={detail} className="truncate text-label text-faint">
            {children}
          </span>
        )}
      </div>
      {aside}
    </div>
  );
}

function AllTime({ stats, className }: { stats: Stats; className?: string }) {
  const rows = [
    ["Sessions", stats.sessions],
    ["Messages", stats.messages],
    ["Tool calls", stats.tool_calls],
  ] as const;
  const since = stats.first_session ? `Since ${shortDate(dayOf(Date.parse(stats.first_session) / MS_PER_HOUR))}` : undefined;
  return (
    <Panel title="All time" aside={since} className={className}>
      <dl className="grid grid-cols-3 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col">
            <dt className="text-label text-muted">{label}</dt>
            <dd className="font-mono text-title font-medium tabular-nums text-ink">
              <CountFlow value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <ModelChart models={stats.by_model} />
    </Panel>
  );
}

const previousHasInput = ({ cache_read, input, cache_write }: Tokens) => cache_read + input + cache_write > 0;

function Overview({ stats, today }: { stats: Stats; today: string }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const current = period(stats.by_hour, range, today);
  const total = sumTokens(current.days.map(({ tokens }) => tokens));
  const previous = current.previous && sumTokens(current.previous.map(({ tokens }) => tokens));
  const active = current.days.map(({ tokens }) => tokens.uncached > 0);
  const activeDays = active.filter(Boolean).length;
  const previousActive = current.previous?.filter(({ tokens }) => tokens.uncached > 0).length;
  const hitRatio = cacheHitRatio(total);
  const hitRatioChange = previous && previousHasInput(previous) ? hitRatio - cacheHitRatio(previous) : null;
  const hint = current.previous ? `vs previous ${RANGES[range].days} days` : RANGE_TITLES[range];
  const emptyText = `No usage in ${RANGE_TITLES[range].toLowerCase()}`;
  const rangeControl = (
    <ToggleGroup aria-label="Range" value={[range]} onValueChange={([next]) => next && setRange(next as RangeKey)}>
      {(Object.keys(RANGES) as RangeKey[]).map((key) => (
        <ToggleGroupItem key={key} value={key} size="sm">
          {RANGES[key].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div className="stats-enter flex flex-col gap-3">
      <section className="flex flex-col gap-3">
        <SectionHeader title={RANGE_TITLES[range]} detail={`${longDate(current.from)} to ${longDate(current.to)}`} aside={rangeControl}>
          {shortDate(current.from)} to {shortDate(current.to)}, local time
        </SectionHeader>
        <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-4">
          <KpiCard
            label="New tokens"
            value={<TokenFlow value={total.uncached} />}
            detail={breakdown(total)}
            delta={change(total.uncached, previous?.uncached)}
            hint={hint}
            chart={<Sparkline values={current.days.map(({ tokens }) => tokens.uncached)} color="var(--chart-1)" />}
          />
          <KpiCard
            label="Output tokens"
            value={<TokenFlow value={total.output} />}
            detail={`${count(total.output)} output tokens`}
            delta={change(total.output, previous?.output)}
            hint={hint}
            chart={<Sparkline values={current.days.map(({ tokens }) => tokens.output)} color="var(--chart-output)" />}
          />
          <KpiCard
            label="Cache hit rate"
            value={<NumberFlow {...FLOW} value={hitRatio} format={{ style: "percent", maximumFractionDigits: 0 }} locales="en-US" />}
            detail={`${count(total.cache_read)} cache read of ${count(total.cache_read + total.input + total.cache_write)} input tokens.`}
            delta={hitRatioChange}
            hint={hint}
            chart={<Sparkline values={current.days.map(({ tokens }) => cacheHitRatio(tokens))} color="var(--chart-2)" />}
          />
          <KpiCard
            label="Active days"
            value={
              <>
                <CountFlow value={activeDays} />
                <span className="ml-1.5 font-sans text-title font-normal text-faint">/ {current.days.length}</span>
              </>
            }
            delta={change(activeDays, previousActive)}
            hint={hint}
            chart={<DayStrip active={active} />}
          />
        </div>
      </section>
      <div className={ROW}>
        <TokensChart days={current.days} emptyText={emptyText} className="@2xl:col-span-2" />
        <TokenMix tokens={total} emptyText={emptyText} />
        <ProjectList projects={stats.by_project} />
      </div>
      <div className={ROW}>
        <Heatmap grid={groupByWeekHour(current.byHour)} emptyText={emptyText} className="@2xl:col-span-2" />
        <AllTime stats={stats} className="@2xl:col-span-2" />
      </div>
    </div>
  );
}

const statsKey = (project: string) => `stats:${project || "all"}`;

function persistedLoad(project: string): Load {
  const stored = readPersisted<Stats>(statsKey(project));
  return stored ? { kind: "ready", stats: stored, fresh: false } : { kind: "loading" };
}

type Props = { project: string; onProject: (path: string) => void };

export function StatsTab({ project, onProject }: Props) {
  const [load, setLoad] = useState<Load>(() => persistedLoad(project));
  const [progress, setProgress] = useState<Progress | null>(null);
  const [today] = useState(() => dayOf(Date.now() / MS_PER_HOUR));
  const indexing = useRef(false);

  useEffect(() => {
    const read = (fetch: () => Promise<Stats | null>, syncProgress = true) =>
      fetch().then(
        (next) => {
          if (!next) return setLoad({ kind: "empty" });
          writePersisted(statsKey(project), next);
          setLoad({ kind: "ready", stats: next, fresh: true });
          if (!syncProgress) return;
          setProgress(next.progress);
          indexing.current = next.progress.files_done < next.progress.files_total;
        },
        (reason) => setLoad({ kind: "failed", message: String(reason) }),
      );
    let lastSnapshot = 0;
    read(() => claudeStats(project || null));
    return onStatsProgress((next) => {
      setProgress(next);
      const wasIndexing = indexing.current;
      indexing.current = next.files_done < next.files_total;
      const finished = wasIndexing && !indexing.current;
      const due = indexing.current && Date.now() - lastSnapshot >= SNAPSHOT_INTERVAL_MS;
      if (!finished && !due) return;
      lastSnapshot = Date.now();
      read(() => claudeStatsSnapshot(project || null), finished);
    });
  }, [project]);

  const reduce = useReducedMotion();
  const showProgress = progress !== null && progress.files_done < progress.files_total;
  const empty = load.kind === "empty" || (load.kind === "ready" && load.stats.messages === 0);

  const updating = load.kind === "ready" && !load.fresh;

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-heading font-semibold text-ink">Statistics</h2>
        <p className="text-body text-muted">Your Claude Code usage on this computer.</p>
        <div className="ml-auto flex items-center gap-3">
          {updating && <span className="text-label text-faint">Updating…</span>}
          <ProjectPicker value={project} onChange={onProject} label="Project:" optional />
        </div>
      </div>
      {load.kind === "failed" ? (
        <Failed message={load.message} />
      ) : (
        <div className="@container flex flex-col">
          <AnimatePresence initial={false}>
            {showProgress && (
              <motion.div
                key="progress"
                initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1, transition: { duration: reduce ? 0.12 : duration.panel, ease: ease.out } }}
                exit={reduce ? { opacity: 0, transition: { duration: 0.12 } } : { height: 0, opacity: 0, transition: { duration: duration.menu, ease: ease.out } }}
                className="overflow-hidden"
              >
                <div className="pb-6">
                  <ProgressBar progress={progress} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {load.kind === "loading" && <Loading />}
          {empty && <EmptyState />}
          {load.kind === "ready" && !empty && <Overview stats={load.stats} today={today} />}
        </div>
      )}
    </div>
  );
}
