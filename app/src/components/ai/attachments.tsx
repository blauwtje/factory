import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Image, X } from "lucide-react";
import { useCallback, useEffect, useState, type ClipboardEvent, type RefObject } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { attachPath, saveAttachment, type Attachment } from "@/ipc";
import { PromptInputHeader } from "./prompt-input";

export type Attached = Attachment & { preview?: string };

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|heic|tiff?)$/i;

export function withAttachments(prompt: string, attachments: readonly Attachment[]) {
  if (attachments.length === 0) return prompt;
  return [prompt, "", "Attached files:", ...attachments.map(({ path }) => path)].join("\n");
}

function dataUrlOf(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function savePasted(file: File): Promise<Attached> {
  const url = await dataUrlOf(file);
  const saved = await saveAttachment(file.name, url.slice(url.indexOf(",") + 1));
  return file.type.startsWith("image/") ? { ...saved, preview: url } : saved;
}

export function useAttachments(form: RefObject<HTMLFormElement | null>) {
  const [items, setItems] = useState<Attached[]>([]);

  const add = useCallback((pending: Promise<Attached>) => {
    pending.then(
      (item) => setItems((current) => (current.some(({ path }) => path === item.path) ? current : [...current, item])),
      (error) => toast.error("Could not attach the file", { description: String(error) }),
    );
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type !== "drop" || !form.current?.checkVisibility()) return;
      payload.paths.forEach((path) => add(attachPath(path)));
    });
    return () => void unlisten.then((stop) => stop());
  }, [add, form]);

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach((file) => add(savePasted(file)));
  }

  async function pick() {
    const paths = await open({ multiple: true });
    paths?.forEach((path) => add(attachPath(path)));
  }

  return {
    items,
    paste,
    pick,
    remove: (path: string) => setItems((current) => current.filter((item) => item.path !== path)),
    clear: () => setItems([]),
  };
}

function Thumb({ item }: { item: Attached }) {
  if (item.preview) return <img src={item.preview} alt="" className="size-6 rounded-md object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />;
  const Icon = IMAGE_FILE.test(item.name) ? Image : FileText;
  return (
    <span className="flex size-6 items-center justify-center">
      <Icon aria-hidden className="size-4 text-muted" />
    </span>
  );
}

export function AttachmentChips({ items, onRemove }: { items: readonly Attached[]; onRemove: (path: string) => void }) {
  if (items.length === 0) return null;
  return (
    <PromptInputHeader>
      <ul aria-label="Attached files" className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.path} title={item.path} className="flex h-8 max-w-60 items-center gap-1.5 rounded-lg bg-raised pl-1 text-label text-ink shadow-[0_0_0_1px_var(--edge)]">
            <Thumb item={item} />
            <span className="truncate">{item.name}</span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.path)} className="mr-0.5">
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </PromptInputHeader>
  );
}
