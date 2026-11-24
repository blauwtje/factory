import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { mcpReconnect, mcpStatus, onAgentEvent, type McpServer } from "@/ipc";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<McpServer["status"], string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-auth": "Needs auth",
  pending: "Connecting",
  disabled: "Disabled",
};

const BUILT_IN = new Set(["factory", "browser"]);

const DOT_CLASS: Record<McpServer["status"], string> = {
  connected: "bg-done",
  failed: "bg-failed",
  "needs-auth": "bg-approval",
  pending: "border-[1.5px] border-waiting",
  disabled: "bg-faint",
};

export function useMcpServers(agentId: string) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((count) => count + 1), []);

  useEffect(() => {
    let current = true;
    mcpStatus(agentId).then(
      (list) => current && setServers(list ?? []),
      () => current && setServers([]),
    );
    return () => {
      current = false;
    };
  }, [agentId, reload]);

  useEffect(() => onAgentEvent(({ agent_id, event }) => agent_id === agentId && "Result" in event && refresh()), [agentId, refresh]);

  const reconnect = async (server: string) => {
    await mcpReconnect(agentId, server);
    refresh();
  };
  return { servers, reconnect };
}

type Props = { servers: McpServer[]; onReconnect: (server: string) => void; onCustomize?: () => void };

export function McpSection({ servers, onReconnect, onCustomize }: Props) {
  return (
    <div className="flex flex-col gap-2 px-2">
      {servers.length === 0 ? (
        <p className="text-pretty text-label text-muted">No MCP servers are connected to this session. Servers you add show up here with their status.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server) => (
            <li key={server.name} className="flex flex-col gap-1 text-label">
              <p className="flex items-center gap-2">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[server.status])} />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {server.name}
                  {BUILT_IN.has(server.name) && <span className="ml-1.5 font-normal text-faint">Built in</span>}
                </span>
                <span className={cn("text-muted", server.status === "failed" && "text-failed-ink", server.status === "needs-auth" && "text-approval-ink")}>{STATUS_LABELS[server.status]}</span>
              </p>
              {server.error && <p className="text-pretty pl-4 text-muted">{server.error}</p>}
              {server.status === "failed" && (
                <Button variant="outline" size="sm" className="ml-4 self-start" onClick={() => onReconnect(server.name)}>
                  Reconnect
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onCustomize && (
        <Button variant="link" size="sm" className="self-start px-0" onClick={onCustomize}>
          Manage in Customize
        </Button>
      )}
    </div>
  );
}
