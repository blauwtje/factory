import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isMac } from "@/lib/platform";
import { startCapture, type Capture } from "./capture";
import { onDictationDownload, prepareDictation, transcribe } from "./ipc";

export type Dictation =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "downloading"; progress: number }
  | { phase: "recording"; level: number }
  | { phase: "transcribing" };

export const MAX_RECORDING_MS = 5 * 60_000;

const IDLE: Dictation = { phase: "idle" };

const MICROPHONE_SETTING = isMac
  ? "Turn on Factory in System Settings > Privacy & Security > Microphone."
  : "Turn on microphone access for Factory in your system privacy settings.";

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<Dictation>(IDLE);
  const capture = useRef<Capture | null>(null);
  const deliver = useRef(onText);

  useEffect(() => {
    deliver.current = onText;
  });

  const cancel = useCallback(() => {
    capture.current?.cancel();
    capture.current = null;
    setState(IDLE);
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      cancel();
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        toast.error("Microphone access is off", { description: MICROPHONE_SETTING });
        return;
      }
      toast.error("Could not dictate", { description: String(error) });
    },
    [cancel],
  );

  async function start() {
    setState({ phase: "starting" });
    const stopListening = onDictationDownload(({ received, total }) =>
      setState({ phase: "downloading", progress: received / total }),
    );
    try {
      await prepareDictation();
    } finally {
      stopListening();
    }
    capture.current = await startCapture((level) => setState({ phase: "recording", level }));
    setState({ phase: "recording", level: 0 });
  }

  async function finish(recorded: Capture) {
    capture.current = null;
    setState({ phase: "transcribing" });
    const text = await transcribe(recorded.stop());
    setState(IDLE);
    if (text) deliver.current(text);
  }

  function toggle() {
    if (state.phase === "idle") void start().catch(fail);
    if (state.phase === "recording" && capture.current) void finish(capture.current).catch(fail);
  }

  const stopAtLimit = useRef<() => void>(() => {});
  useEffect(() => {
    stopAtLimit.current = () => {
      if (!capture.current) return;
      toast.info("Dictation stopped after 5 minutes");
      void finish(capture.current).catch(fail);
    };
  });

  useEffect(() => {
    if (state.phase !== "recording") return;
    const timer = setTimeout(() => stopAtLimit.current(), MAX_RECORDING_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "recording") return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [state.phase, cancel]);

  useEffect(() => {
    const recording = capture;
    return () => recording.current?.cancel();
  }, []);

  return { state, toggle };
}
