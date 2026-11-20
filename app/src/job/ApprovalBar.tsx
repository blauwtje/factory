import { ActionButton, type Action } from "./SessionBar";

export function ApprovalBar({ action }: { action: Action }) {
  return (
    <section aria-label="Plan approval" className="mb-2 flex items-center gap-3 rounded-lg border border-edge bg-approval-soft/35 px-3 py-2">
      <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-label">
        <span className="font-medium text-approval-ink">Plan ready for approval</span>
        <span className="text-muted">Or reply below: typing a message asks for changes.</span>
      </p>
      <ActionButton action={action} />
    </section>
  );
}
