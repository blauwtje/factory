import { useEffect, useState } from "react";
import { listAccounts, onAccounts, type Account } from "@/ipc";

let latest: Account[] | null = null;
let stop: (() => void) | null = null;
const subscribers = new Set<(accounts: Account[]) => void>();

function publish(accounts: Account[]) {
  latest = accounts;
  subscribers.forEach((notify) => notify(accounts));
}

function subscribe(notify: (accounts: Account[]) => void) {
  subscribers.add(notify);
  if (!stop) {
    stop = onAccounts(publish);
    if (!latest) void listAccounts().then((accounts) => latest ?? publish(accounts ?? []));
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size > 0) return;
    stop?.();
    stop = null;
  };
}

export function useAccounts() {
  const [accounts, setAccounts] = useState(latest);
  useEffect(() => subscribe(setAccounts), []);
  return accounts;
}

export const accountFor = (accounts: Account[], id?: string | null) => accounts.find((account) => account.id === id) ?? accounts.find((account) => account.is_default) ?? accounts[0];

const NOW_TICK_MS = 30_000;

export function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}
