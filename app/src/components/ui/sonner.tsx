import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useScheme } from "@/lib/theme";

const icons = {
  success: <CircleCheck className="size-4 text-done" />,
  info: <Info className="size-4 text-muted" />,
  warning: <TriangleAlert className="size-4 text-approval" />,
  error: <OctagonX className="size-4 text-failed" />,
  loading: <LoaderCircle className="size-4 animate-spin text-muted" />,
};

const style = {
  "--normal-bg": "var(--overlay)",
  "--normal-text": "var(--ink)",
  "--normal-border": "transparent",
  "--border-radius": "var(--radius-lg)",
} as CSSProperties;

export function Toaster(props: ToasterProps) {
  const scheme = useScheme();
  return (
    <Sonner
      theme={scheme}
      position="bottom-right"
      icons={icons}
      style={style}
      toastOptions={{ classNames: { toast: "font-sans text-body shadow-popover!", description: "text-muted!" } }}
      {...props}
    />
  );
}
