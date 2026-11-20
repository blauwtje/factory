const PREFIX = "factory:";
const VERSION = 1;

export function readPersisted<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(PREFIX + key);
    if (stored === null) return null;
    const parsed = JSON.parse(stored) as { v?: unknown; value?: T };
    return parsed.v === VERSION && parsed.value !== undefined ? parsed.value : null;
  } catch {
    return null;
  }
}

export function writePersisted(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: VERSION, value }));
  } catch {
    return;
  }
}
