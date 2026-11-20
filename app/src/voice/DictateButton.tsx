import { Mic } from "lucide-react";
import type { ReactNode } from "react";
import { Loader } from "@/components/ai/loader";
import { PromptInputButton } from "@/components/ai/prompt-input";
import { useDictation, type Dictation } from "./useDictation";

export type DictateButtonProps = { onText: (text: string) => void; disabled?: boolean };

function ProgressRing({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${progress * 100} 100`}
      />
    </svg>
  );
}

function RecordingDot({ level }: { level: number }) {
  return (
    <span className="relative flex size-5 items-center justify-center" aria-hidden>
      <span
        className="absolute inset-0 rounded-full bg-failed/25 transition-transform duration-100 ease-out"
        style={{ transform: `scale(${0.4 + level * 0.6})` }}
      />
      <span className="relative size-2 rounded-full bg-failed" />
    </span>
  );
}

const percent = (progress: number) => `${Math.round(progress * 100)}%`;

type Look = { label: string; tooltip: string; icon: ReactNode };

function look(state: Dictation): Look {
  switch (state.phase) {
    case "idle":
      return { label: "Dictate", tooltip: "Dictate", icon: <Mic /> };
    case "starting":
      return { label: "Starting dictation", tooltip: "Starting…", icon: <Mic /> };
    case "downloading":
      return {
        label: `Downloading speech model, ${percent(state.progress)}`,
        tooltip: `Downloading speech model · ${percent(state.progress)}`,
        icon: <ProgressRing progress={state.progress} />,
      };
    case "recording":
      return { label: "Stop dictation", tooltip: "Stop · Esc to cancel", icon: <RecordingDot level={state.level} /> };
    case "transcribing":
      return { label: "Transcribing", tooltip: "Transcribing…", icon: <Loader size="sm" label="Transcribing" /> };
  }
}

export function DictateButton({ onText, disabled }: DictateButtonProps) {
  const { state, toggle } = useDictation(onText);
  const { label, tooltip, icon } = look(state);
  const busy = state.phase === "starting" || state.phase === "downloading" || state.phase === "transcribing";
  return (
    <PromptInputButton
      size="icon-sm"
      tooltip={tooltip}
      aria-label={label}
      aria-pressed={state.phase === "recording"}
      aria-busy={busy}
      disabled={disabled && state.phase === "idle"}
      onClick={toggle}
    >
      {icon}
    </PromptInputButton>
  );
}
