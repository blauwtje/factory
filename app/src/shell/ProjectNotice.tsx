import { useEffect, useState } from "react";
import { listCustomize, listProjects, type CustomizeItem, type CustomizeKind } from "@/ipc";

const LABELS: Partial<Record<CustomizeKind, string>> = { hook: "hook", mcp: "MCP server" };

const plural = (count: number, label: string) => `${count} ${label}${count === 1 ? "" : "s"}`;

function describe(items: CustomizeItem[]) {
  const counts = Object.entries(LABELS).flatMap(([kind, label]) => {
    const count = items.filter((item) => item.kind === kind).length;
    return count > 0 ? [plural(count, label)] : [];
  });
  return `This repo brings ${counts.join(" and ")}: ${items.map((item) => item.name).join(", ")}.`;
}

export function ProjectNotice({ path }: { path: string }) {
  const [found, setFound] = useState<{ path: string; items: CustomizeItem[] }>({ path, items: [] });

  useEffect(() => {
    let current = true;
    (async () => {
      const known = (await listProjects()).some((project) => project.path === path);
      if (known) return;
      const { items } = await listCustomize(path);
      if (current) setFound({ path, items: items.filter((item) => item.source === "project" && item.kind in LABELS) });
    })().catch(() => {});
    return () => {
      current = false;
    };
  }, [path]);

  const items = found.path === path ? found.items : [];
  if (items.length === 0) return null;
  return <p className="px-1 text-label text-pretty text-muted">{describe(items)}</p>;
}
