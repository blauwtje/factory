import { useEffect, useRef, useState, type ClipboardEvent, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { AttachmentChips, useAttachments, withAttachments } from "@/components/ai/attachments";
import { ModelMenu } from "@/components/ai/model-menu";
import { insertAtCursor, PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai/prompt-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { parseGithubUrl, withGithubLinks, type GithubLink } from "@/chat/github";
import { AddMenu } from "@/chat/AddMenu";
import { GithubChips } from "@/chat/GithubChip";
import { SlashMenu, useSlashMenu } from "@/chat/SlashMenu";
import { createJob, listProjects, projectAccounts, setProjectAccount } from "@/ipc";
import { PermissionMenu } from "@/job/AgentControls";
import { usePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { useLeadItems } from "@/new-job/lead";
import { AccountChip } from "@/usage/AccountChip";
import { folderAccountId } from "@/usage/folderRules";
import { accountFor, useAccounts } from "@/usage/useAccounts";
import { DictateButton } from "@/voice/DictateButton";
import { ProjectAvatar } from "./brand";
import { ProjectNotice } from "./ProjectNotice";
import { ProjectPicker } from "./ProjectPicker";
import { STATUS_TONE, STATUS_WORD, StatusDot } from "./status";
import { dayPart } from "./greeting";
import { relativeTime } from "./time";
import { STATUS_LABELS, type ProjectSummary, type SessionSummary } from "./types";

type Props = {
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  compose: Compose;
  onCreated: (id: string) => void;
};

export type Compose = { key: number; project_path?: string };

type Entry = { project: ProjectSummary; session: SessionSummary };

type Block = { title: string; count?: number; body: ReactNode };

const RECENT = 6;
const PROMPT = "What should we build?";

const STEPS = [
  { title: "Plan", text: "The Orchestrator reads the project and writes a plan for you to approve." },
  { title: "Build", text: "Agents work in their own git worktree and branch, so your checkout stays as it is." },
  { title: "Merge", text: "Review the changes, then merge the branch back into your project." },
];

const ARROW_STEP: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

type StartBoxProps = {
  prompt: string;
  onPrompt: Dispatch<SetStateAction<string>>;
  projectPath: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  onCreated: Props["onCreated"];
};

function StartBox({ prompt, onPrompt, projectPath, textarea, onCreated }: StartBoxProps) {
  const [leadModel] = usePref("leadModel", "");
  const [leadEffort] = usePref("leadEffort", "");
  const [model, setModel] = useState(leadModel);
  const [effort, setEffort] = useState(leadEffort);
  const [permissionMode, setPermissionMode] = usePref("leadPermissionMode", "");
  const { models, efforts } = useLeadItems();
  const form = useRef<HTMLFormElement>(null);
  const attachments = useAttachments(form);
  const [busy, setBusy] = useState(false);
  const accounts = useAccounts();
  const [remembered, setRemembered] = useState<{ projectPath: string; id: string | null } | null>(null);
  const projectAccount = remembered?.projectPath === projectPath ? remembered.id : undefined;
  const [picked, setPicked] = useState<{ projectPath: string; id: string } | null>(null);
  const pickedId = picked?.projectPath === projectPath ? picked.id : null;
  const account = accounts && accountFor(accounts, pickedId ?? projectAccount);
  const [links, setLinks] = useState<GithubLink[]>([]);
  const slash = useSlashMenu(prompt, onPrompt, textarea, projectPath);
  const ready = (prompt.trim() !== "" || links.length > 0) && projectPath !== "" && !busy;

  useEffect(() => {
    if (!projectPath) return;
    void projectAccounts().then((map) => setRemembered({ projectPath, id: folderAccountId(map ?? {}, projectPath) }));
  }, [projectPath]);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const { id, initialized } = await createJob({ project_path: projectPath, ...(account && (pickedId !== null || projectAccount !== undefined) && { account_id: account.id }), prompt: withAttachments(withGithubLinks(prompt, links), attachments.items), ...(model && { model }), ...(effort && { effort }), ...(permissionMode && { permission_mode: permissionMode }) });
      if (initialized) toast.info("Set up git in this folder", { description: "Added an empty first commit so sessions can use a worktree. Your files were not committed." });
      onPrompt("");
      setLinks([]);
      attachments.clear();
      onCreated(id);
    } catch (error) {
      toast.error("Could not start the session", { description: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const link = parseGithubUrl(event.clipboardData.getData("text/plain"));
    if (!link) return attachments.paste(event);
    event.preventDefault();
    setLinks((current) => (current.some(({ url }) => url === link.url) ? current : [...current, link]));
  }

  return (
    <PromptInput ref={form} onSubmit={submit}>
      <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
      <GithubChips links={links} onRemove={(url) => setLinks((current) => current.filter((link) => link.url !== url))} />
      {slash.open && <SlashMenu matches={slash.matches} selected={slash.selected} onPick={slash.pick} />}
      <PromptInputTextarea
        ref={textarea}
        autoFocus
        aria-label={PROMPT}
        placeholder={PROMPT}
        value={prompt}
        onChange={(event) => {
          onPrompt(event.target.value);
          slash.track(event.target);
        }}
        onSelect={(event) => slash.track(event.currentTarget)}
        onKeyDown={slash.keyDown}
        {...slash.textareaProps}
        onPaste={paste}
        className="min-h-32"
      />
      <PromptInputFooter>
        <PromptInputTools>
          <AddMenu entries={slash.entries} onAttach={attachments.pick} onInsert={(text) => onPrompt(insertAtCursor(textarea.current, text))} />
          <DictateButton onText={(text) => onPrompt(insertAtCursor(textarea.current, text))} />
        </PromptInputTools>
        <PromptInputTools className="gap-1.5">
          {accounts && account && (
            <AccountChip
              accounts={accounts}
              account={account}
              onPick={(id) => setPicked({ projectPath, id })}
              forProject={pickedId !== null && pickedId !== projectAccount}
              onUseForProject={() => {
                if (!pickedId) return;
                void setProjectAccount(projectPath, pickedId).then(() => setRemembered({ projectPath, id: pickedId }));
              }}
            />
          )}
          <PermissionMenu mode={permissionMode} title="Permissions · new sessions" onChange={setPermissionMode} />
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <ModelMenu
                header="Orchestrator"
                model={model}
                effort={effort}
                models={models}
                efforts={efforts}
                onChange={(next) => {
                  setModel(next.model);
                  setEffort(next.effort);
                }}
              />
            </TooltipTrigger>
            <TooltipContent>Model and effort of the Orchestrator. Subagents get theirs from the Agents settings.</TooltipContent>
          </Tooltip>
          <PromptInputSubmit disabled={!ready} />
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

function SessionLink({ id, onOpen, className, children }: { id: string; onOpen: Props["onOpen"]; className?: string; children: ReactNode }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        onOpen(id);
      }}
      className={cn("ui-focus", className)}
    >
      {children}
    </a>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-1.5 text-label font-medium text-muted">
        {title}
        {count !== undefined && <span className="text-caption tabular-nums text-faint">· {count}</span>}
      </h2>
      {children}
    </section>
  );
}

function ProjectLine({ project, children }: { project: ProjectSummary; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-label text-muted">
      <ProjectAvatar name={project.name} className="size-4 rounded-xs" />
      <span className="truncate">{project.name}</span>
      {children}
    </span>
  );
}

const ROW = "flex items-center gap-3 px-3 py-2.5 transition-colors duration-(--duration-press) hover:bg-active/60 focus-visible:bg-active/60";
const LIST = "-mx-3 flex flex-col divide-y divide-rule";

const NEEDS_YOU: string[] = ["approval", "failed", "done"];
const READY_TO_MERGE = { label: "Ready to merge", className: "text-done-ink" };

function NeedsYou({ entries, onOpen }: { entries: Entry[]; onOpen: Props["onOpen"] }) {
  return (
    <ul className={LIST}>
      {entries.map(({ project, session }) => (
        <li key={session.id}>
          <SessionLink id={session.id} onOpen={onOpen} className={ROW}>
            <StatusDot status={session.status} />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{session.title}</span>
            <ProjectLine project={project} />
            <span className={cn("text-label font-medium", session.status === "done" ? READY_TO_MERGE.className : STATUS_WORD[session.status]?.className)}>{session.status === "done" ? READY_TO_MERGE.label : STATUS_LABELS[session.status]}</span>
          </SessionLink>
        </li>
      ))}
    </ul>
  );
}

function Running({ entries, onOpen }: { entries: Entry[]; onOpen: Props["onOpen"] }) {
  return (
    <ul className={LIST}>
      {entries.map(({ project, session }) => (
        <li key={session.id}>
          <SessionLink id={session.id} onOpen={onOpen} className={ROW}>
            <StatusDot status={session.status} />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{session.title}</span>
            <ProjectLine project={project} />
            <TextShimmer className="text-label font-medium">{STATUS_LABELS[session.status]}</TextShimmer>
            {session.createdAt !== undefined && <span className="w-9 shrink-0 text-right text-caption text-faint">{relativeTime(session.createdAt)}</span>}
          </SessionLink>
        </li>
      ))}
    </ul>
  );
}

function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  const step = ARROW_STEP[event.key];
  if (!step) return;
  event.preventDefault();
  const links = [...event.currentTarget.querySelectorAll("a")];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  links[Math.min(links.length - 1, Math.max(0, index + step))]?.focus();
}

function Recent({ entries, onOpen }: { entries: Entry[]; onOpen: Props["onOpen"] }) {
  return (
    <ul className={LIST} onKeyDown={moveFocus}>
      {entries.map(({ project, session }) => (
        <li key={session.id}>
          <SessionLink id={session.id} onOpen={onOpen} className={ROW}>
            <StatusDot status={session.status} />
            <span className="min-w-0 flex-1 truncate text-body text-ink">{session.title}</span>
            <ProjectLine project={project} />
            {session.status !== "waiting" && <span className={cn("font-mono text-caption", STATUS_WORD[session.status]?.className)}>{STATUS_LABELS[session.status]}</span>}
            {session.createdAt !== undefined && <span className="w-9 shrink-0 text-right text-caption text-faint">{relativeTime(session.createdAt)}</span>}
          </SessionLink>
        </li>
      ))}
    </ul>
  );
}

function Steps() {
  return (
    <Section title="How a session runs">
      <ol className="grid gap-3 @3xl:grid-cols-3">
        {STEPS.map(({ title, text }) => (
          <li key={title} className="flex flex-col gap-1.5 rounded-xl border border-rule p-4">
            <span className="text-body font-medium text-ink">{title}</span>
            <span className="text-label text-pretty text-muted">{text}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function sessionsOf(projects: ProjectSummary[]) {
  return projects
    .flatMap((project) => project.sessions.map((session) => ({ project, session })))
    .sort((a, b) => (b.session.createdAt ?? 0) - (a.session.createdAt ?? 0));
}

function Desk({ projects, initialPath, onOpen, onCreated }: Omit<Props, "compose"> & { initialPath?: string }) {
  const [prompt, setPrompt] = useState("");
  const [projectPath, setProjectPath] = useState(initialPath ?? "");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sessions = sessionsOf(projects);
  const needsYou = sessions.filter(({ session }) => NEEDS_YOU.includes(STATUS_TONE[session.status]));
  const running = sessions.filter(({ session }) => STATUS_TONE[session.status] === "running");
  const recent = sessions.filter(({ session }) => !NEEDS_YOU.includes(STATUS_TONE[session.status]) && STATUS_TONE[session.status] !== "running").slice(0, RECENT);
  const blocks: (Block | false)[] = [
    needsYou.length > 0 && { title: "Needs attention", count: needsYou.length, body: <NeedsYou entries={needsYou} onOpen={onOpen} /> },
    running.length > 0 && { title: "Running", count: running.length, body: <Running entries={running} onOpen={onOpen} /> },
    recent.length > 0 && { title: "Recent", count: recent.length, body: <Recent entries={recent} onOpen={onOpen} /> },
  ];
  const sections = blocks.filter((block) => block !== false);

  useEffect(() => {
    void listProjects().then((recent) => setProjectPath((current) => current || recent[0]?.path || ""));
  }, []);

  return (
    <div className="@container h-full overflow-y-auto">
      <div className="mx-auto grid min-h-full w-full max-w-4xl gap-x-8 gap-y-10 px-8 py-10">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-1 flex-col justify-end">
            <h1 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-heading font-normal text-muted">
              <span>
                {dayPart()}
                {projectPath ? "," : "."}
              </span>{" "}
              <ProjectPicker value={projectPath} onChange={setProjectPath} />{" "}
              <span>{projectPath ? "is on the bench." : "to start."}</span>
            </h1>
          </div>
          <StartBox prompt={prompt} onPrompt={setPrompt} projectPath={projectPath} textarea={textarea} onCreated={onCreated} />
          <div className="flex flex-1 flex-col gap-4">
            {projectPath && <ProjectNotice path={projectPath} />}
            <div className="flex flex-col gap-10 pt-6">
              {sessions.length === 0 && <Steps />}
              {sections.map(({ title, count, body }) => (
                <Section key={title} title={title} count={count}>
                  {body}
                </Section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Home({ compose, ...rest }: Props) {
  return <Desk key={compose.key} initialPath={compose.project_path} {...rest} />;
}
