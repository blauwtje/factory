import { describe, expect, it } from "vitest";
import { trayStatus } from "@/shell/tray-status";
import type { JobStatus, ProjectSummary } from "@/shell/types";

function projectWith(...sessions: [JobStatus, boolean?][]): ProjectSummary[] {
  return [
    {
      path: "/p",
      name: "p",
      sessions: sessions.map(([status, archived], i) => ({ id: `s${i}`, title: "t", status, archived })),
    },
  ];
}

describe("trayStatus", () => {
  it("is empty when nothing runs or waits", () => {
    expect(trayStatus(projectWith(["done"], ["failed"], ["waiting"]))).toEqual({ title: "", tooltip: "Factory" });
  });

  it("shows running sessions", () => {
    expect(trayStatus(projectWith(["planning"], ["building"]))).toEqual({
      title: "2 running",
      tooltip: "Factory: 2 running",
    });
  });

  it("puts sessions that need you first", () => {
    expect(trayStatus(projectWith(["building"], ["planning"], ["awaiting_approval"]))).toEqual({
      title: "1 needs you",
      tooltip: "Factory: 2 running, 1 needs you",
    });
  });

  it("ignores archived sessions", () => {
    expect(trayStatus(projectWith(["building", true], ["awaiting_approval", true]))).toEqual({
      title: "",
      tooltip: "Factory",
    });
  });
});
