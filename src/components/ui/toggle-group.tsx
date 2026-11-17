import * as React from "react";
import { ToggleGroup as TG } from "radix-ui";
import { cn } from "@/lib/utils";

export function Segmented({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return <TG.Root className={cn("flex gap-0.5 rounded-md bg-muted p-0.5", className)} {...props} />;
}
export function SegmentedItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      className={cn(
        "h-6 min-w-9 rounded-sm px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
