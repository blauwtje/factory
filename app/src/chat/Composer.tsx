import { useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { AttachmentChips, useAttachments, withAttachments } from "@/components/ai/attachments";
import {
  insertAtCursor,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai/prompt-input";
import { DictateButton } from "@/voice/DictateButton";
import { AddMenu } from "./AddMenu";
import { parseGithubUrl, withGithubLinks, type GithubLink } from "./github";
import { GithubChips } from "./GithubChip";
import { SlashMenu, useSlashMenu } from "./SlashMenu";

type ComposerProps = {
  working: boolean;
  blocked?: string;
  tools?: ReactNode;
  project?: string | null;
  onSend: (text: string) => void;
  onStop?: () => void;
};

export function Composer({ working, blocked, tools, project = null, onSend, onStop }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const attachments = useAttachments(form);
  const [links, setLinks] = useState<GithubLink[]>([]);
  const slash = useSlashMenu(draft, setDraft, textarea, project);
  const empty = draft.trim() === "" && links.length === 0;
  const stops = working && empty && onStop !== undefined;

  function submit() {
    if (empty) return;
    const text = withGithubLinks(draft.trim(), links);
    setDraft("");
    setLinks([]);
    attachments.clear();
    onSend(withAttachments(text, attachments.items));
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
        aria-label="Message"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          slash.track(event.target);
        }}
        onSelect={(event) => slash.track(event.currentTarget)}
        onKeyDown={slash.keyDown}
        {...slash.textareaProps}
        onPaste={paste}
        placeholder={blocked ?? "Message the agent"}
      />
      <PromptInputFooter>
        <PromptInputTools>
          <AddMenu entries={slash.entries} onAttach={attachments.pick} onInsert={(text) => setDraft(insertAtCursor(textarea.current, text))} />
          <DictateButton onText={(text) => setDraft(insertAtCursor(textarea.current, text))} />
        </PromptInputTools>
        <PromptInputTools className="gap-1.5">
          {tools}
          <PromptInputSubmit
            status={stops ? "streaming" : "idle"}
            onStop={stops ? onStop : undefined}
            disabled={!stops && empty}
          />
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}
