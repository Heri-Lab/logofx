import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={200}>{children}</T.Provider>
);

export function Tip({
  label,
  kbd,
  side = "top",
  children,
}: {
  label: React.ReactNode;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md",
            "origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {label}
          {kbd && <kbd className="rounded-sm bg-background/10 px-1 font-sans text-[10px] text-background/70">{kbd}</kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
