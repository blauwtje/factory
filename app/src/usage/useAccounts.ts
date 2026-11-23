import { useEffect, useState } from "react";
import { listAccounts, onAccounts, type Account } from "@/ipc";
import { readPersisted, writePersisted } from "@/lib/persisted";

let latest: Account[] | null = readPersisted<Account[]>("accounts");
let fresh = false;
let stop: (() => void) | null = null;
const subscribers = new Set<(accounts: Account[]) => void>();

function publish(accounts: Account[]) {
  latest = accounts;
  fresh = true;
  writePersisted("accounts", accounts.map((account) => ({ ...account, refreshing: false })));
  subscribers.forEach((notify) => notify(accounts));
}

function subscribe(notify: (accounts: Account[]) => void) {
  subscribers.add(notify);
  if (!stop) {
    stop = onAccounts(publish);
    if (!fresh) void listAccounts().then((accounts) => fresh || publish(accounts ?? []));
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

export function useNow(tickMs = NOW_TICK_MS) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}
