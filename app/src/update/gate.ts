export type RestartInput = { installed: boolean; idle: boolean; focused: boolean };

export function restartAction({ installed, idle, focused }: RestartInput): "none" | "wait" | "restart" {
  if (!installed) return "none";
  return idle && focused ? "restart" : "wait";
}
