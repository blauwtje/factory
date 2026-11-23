import { readPersisted, writePersisted } from "./persisted";

const requests = new Map<string, Promise<unknown>>();

export function cached<T>(key: string): T | undefined {
  return readPersisted<T>(key) ?? undefined;
}

export function remember<T>(key: string, value: T): T {
  writePersisted(key, value);
  return value;
}

export function fetchCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = requests.get(key);
  if (running) return running as Promise<T>;
  const request = load()
    .then((value) => remember(key, value))
    .finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}
