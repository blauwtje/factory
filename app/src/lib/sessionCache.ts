import type { Turn } from "@/chat/types";
import type { JobLinks } from "@/ipc";
import type { AgentRow } from "@/job/types";

export const agentsByJob = new Map<string, AgentRow[]>();
export const historyByAgent = new Map<string, Turn[]>();
export const linksByJob = new Map<string, JobLinks>();
