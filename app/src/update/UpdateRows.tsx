import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Panel, Row, Rows } from "@/settings/parts";
import { RELEASES_URL, checkForUpdate, installUpdate, setWhatsNew, useUpdateState, type UpdateState } from "./store";

function summary(state: UpdateState) {
  if (state.kind === "checking") return "Checking";
  if (state.kind === "current") return "Up to date";
  if (state.kind === "available") return `${state.update.version} is available`;
  if (state.kind === "downloading") return state.percent === null ? "Downloading" : `Downloading ${state.percent}%`;
  if (state.kind === "waiting") return "Restarting when agents finish";
  if (state.kind === "error") return state.message;
  return "";
}

export function UpdateRows({ version }: { version: string | null }) {
  const state = useUpdateState();
  const busy = state.kind === "checking" || state.kind === "downloading" || state.kind === "waiting";
  return (
    <Panel title="Updates">
      <Rows>
        <Row label="Current version">
          <span className="font-mono text-label">{version ?? ""}</span>
        </Row>
        <Row label="Check for updates">
          <span className="flex items-center gap-3">
            <span className="text-label text-muted">{summary(state)}</span>
            {state.kind === "available" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setWhatsNew(true)}>
                  What&apos;s new
                </Button>
                <Button size="sm" onClick={() => void installUpdate(state.update)}>
                  Update
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void checkForUpdate()}>
              Check for updates
            </Button>
          </span>
        </Row>
        <Row label="Release notes">
          <Button variant="outline" size="sm" onClick={() => void openUrl(RELEASES_URL).catch(() => undefined)}>
            Release notes
          </Button>
        </Row>
      </Rows>
    </Panel>
  );
}
