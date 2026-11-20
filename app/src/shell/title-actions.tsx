import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Slot = { node: HTMLElement | null; setNode: (node: HTMLElement | null) => void };

const SlotContext = createContext<Slot>({ node: null, setNode: () => {} });

export function TitleActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return <SlotContext.Provider value={{ node, setNode }}>{children}</SlotContext.Provider>;
}

export function TitleActionsSlot() {
  const { setNode } = useContext(SlotContext);
  return <div ref={setNode} className="ml-auto flex items-center gap-0.5" />;
}

export function TitleActions({ children }: { children: ReactNode }) {
  const { node } = useContext(SlotContext);
  return node ? createPortal(children, node) : null;
}
