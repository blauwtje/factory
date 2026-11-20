import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";

export function Separator({ className, orientation = "horizontal", ...props }: BaseSeparator.Props) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn("shrink-0 bg-edge data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch", className)}
      {...props}
    />
  );
}
