import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { DictateButton } from "@/voice/DictateButton";
import { startCapture } from "@/voice/capture";
import { MAX_RECORDING_MS } from "@/voice/useDictation";

const recorded = new Float32Array([0.25, -0.5]);
const capture = { stop: vi.fn(() => recorded), cancel: vi.fn() };
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/voice/capture", () => ({ startCapture: vi.fn(async () => capture) }));

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await act(async () => {});
  clearMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

test("the button walks from download to recording to transcribing and Escape cancels", async () => {
  const model = deferred<null>();
  const heard = deferred<string>();
  const sent: unknown[] = [];
  mockIPC(
    async (cmd, args) => {
      if (cmd === "prepare_dictation") {
        await emit("dictation-download", { received: 50, total: 100 });
        return model.promise;
      }
      if (cmd === "transcribe") {
        sent.push(args);
        return heard.promise;
      }
    },
    { shouldMockEvents: true },
  );
  const onText = vi.fn();
  render(<DictateButton onText={onText} />);

  fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
  expect(await screen.findByRole("button", { name: "Downloading speech model, 50%" })).not.toBeNull();

  await act(async () => model.resolve(null));
  const stop = screen.getByRole("button", { name: "Stop dictation" });
  expect(stop.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(stop);
  expect(await screen.findByRole("button", { name: "Transcribing" })).not.toBeNull();
  expect(sent).toEqual([new Uint8Array(recorded.buffer)]);

  await act(async () => heard.resolve("Kun je de sidebar refactoren?"));
  expect(onText).toHaveBeenCalledWith("Kun je de sidebar refactoren?");

  fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
  await screen.findByRole("button", { name: "Stop dictation" });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(await screen.findByRole("button", { name: "Dictate" })).not.toBeNull();
  expect(capture.cancel).toHaveBeenCalledOnce();
  expect(onText).toHaveBeenCalledOnce();
});

test("a denied microphone says where to turn it on", async () => {
  mockIPC(async () => null, { shouldMockEvents: true });
  vi.mocked(startCapture).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
  render(<DictateButton onText={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "Dictate" }));

  await screen.findByRole("button", { name: "Dictate" });
  expect(toast.error).toHaveBeenCalledWith("Microphone access is off", {
    description: "Turn on microphone access for Factory in your system privacy settings.",
  });
});

test("a dictation stops and is transcribed after five minutes", async () => {
  const sent: unknown[] = [];
  mockIPC(
    async (cmd, args) => {
      if (cmd === "transcribe") {
        sent.push(args);
        return "gedicteerd";
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  const onText = vi.fn();
  render(<DictateButton onText={onText} />);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dictate" })));
  expect(screen.getByRole("button", { name: "Stop dictation" })).not.toBeNull();

  await act(async () => vi.advanceTimersByTime(MAX_RECORDING_MS));
  vi.useRealTimers();

  expect(await screen.findByRole("button", { name: "Dictate" })).not.toBeNull();
  expect(sent).toEqual([new Uint8Array(recorded.buffer)]);
  expect(onText).toHaveBeenCalledWith("gedicteerd");
  expect(toast.info).toHaveBeenCalledWith("Dictation stopped after 5 minutes");
});
