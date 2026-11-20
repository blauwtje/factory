import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge<"chat-column">({
  extend: {
    theme: {
      text: ["micro", "caption", "label", "note", "body", "prose", "title", "heading", "display"],
      shadow: ["popover", "dialog", "composer"],
    },
    classGroups: {
      "chat-column": ["chat-column"],
    },
    conflictingClassGroups: {
      "chat-column": ["p", "px", "mx", "w", "max-w"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
