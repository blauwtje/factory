import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Download = { received: number; total: number };

export const prepareDictation = () => invoke("prepare_dictation");
export const transcribe = (samples: Float32Array) =>
  invoke<string>("transcribe", new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));

export function onDictationDownload(handler: (download: Download) => void) {
  const unlisten = listen<Download>("dictation-download", ({ payload }) => handler(payload));
  return () => void unlisten.then((stop) => stop());
}
