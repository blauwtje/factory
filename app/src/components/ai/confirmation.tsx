import { ShieldAlert, type LucideIcon } from "lucide-react";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ApprovalState = "requested" | "approved" | "denied";

const ConfirmationContext = createContext<ApprovalState>("requested");

export function Confirmation({ className, state, children, ...props }: ComponentProps<"section"> & { state: ApprovalState }) {
  return (
    <ConfirmationContext.Provider value={state}>
      <section
        data-state={state}
        className={cn(
          "group/confirmation relative flex flex-col gap-3 overflow-hidden rounded-lg border border-edge bg-transparent p-3.5 text-body data-[state=requested]:border-[color-mix(in_oklab,var(--approval)_40%,var(--edge))] data-[state=requested]:bg-[color-mix(in_oklab,var(--approval-soft)_35%,transparent)]",
          className,
        )}
        {...props}
      >
        {children}
      </section>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationTitle({ className, children, icon: Icon = ShieldAlert, ...props }: ComponentProps<"div"> & { icon?: LucideIcon }) {
  return (
    <div className={cn("flex items-center gap-2.5 text-ink", className)} {...props}>
      <span className="flex size-5 shrink-0 items-center justify-center text-approval group-data-[state=approved]/confirmation:text-done group-data-[state=denied]/confirmation:text-failed">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function When({ state, children }: { state: ApprovalState; children?: ReactNode }) {
  return useContext(ConfirmationContext) === state ? children : null;
}

export const ConfirmationRequest = ({ children }: { children?: ReactNode }) => <When state="requested">{children}</When>;
export const ConfirmationAccepted = ({ children }: { children?: ReactNode }) => <When state="approved">{children}</When>;
export const ConfirmationRejected = ({ children }: { children?: ReactNode }) => <When state="denied">{children}</When>;

export function ConfirmationActions({ className, ...props }: ComponentProps<"div">) {
  if (useContext(ConfirmationContext) !== "requested") return null;
  return <div className={cn("flex items-center justify-end gap-2 self-end", className)} {...props} />;
}

export function ConfirmationAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button size="sm" className={cn("h-8 gap-2 pr-2 pl-3.5", className)} {...props} />;
}
