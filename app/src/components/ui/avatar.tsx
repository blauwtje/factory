import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@/lib/utils";

export function Avatar({ className, ...props }: BaseAvatar.Root.Props) {
  return (
    <BaseAvatar.Root
      className={cn("relative inline-flex size-7 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-active align-middle", className)}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: BaseAvatar.Image.Props) {
  return <BaseAvatar.Image className={cn("size-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: BaseAvatar.Fallback.Props) {
  return <BaseAvatar.Fallback className={cn("flex size-full items-center justify-center text-label font-medium text-muted", className)} {...props} />;
}
