import workletUrl from "./capture-worklet.js?url";

export const SAMPLE_RATE = 16_000;
const LEVEL_WINDOW = SAMPLE_RATE / 10;

export type Capture = { stop: () => Float32Array; cancel: () => void };

function loudness(chunks: Float32Array[]) {
  let sum = 0;
  let count = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) sum += sample * sample;
    count += chunk.length;
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / count)) * 2);
}

function join(chunks: Float32Array[]) {
  const samples = new Float32Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

export async function startCapture(onLevel: (level: number) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const close = () => {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    close();
    throw error;
  }
  const node = new AudioWorkletNode(context, "capture");
  const chunks: Float32Array[] = [];
  let recent: Float32Array[] = [];
  let recentLength = 0;
  node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    chunks.push(data);
    recent.push(data);
    recentLength += data.length;
    if (recentLength < LEVEL_WINDOW) return;
    onLevel(loudness(recent));
    recent = [];
    recentLength = 0;
  };
  context.createMediaStreamSource(stream).connect(node).connect(context.destination);
  const end = () => {
    node.port.onmessage = null;
    close();
  };
  return {
    stop() {
      end();
      return join(chunks);
    },
    cancel: end,
  };
}
