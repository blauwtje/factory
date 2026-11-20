export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

export const duration = {
  press: 0.12,
  tooltip: 0.15,
  menu: 0.18,
  panel: 0.22,
  dialog: 0.22,
  toast: 0.4,
} as const;

export const spring = { type: "spring", duration: 0.45, bounce: 0.15 } as const;
