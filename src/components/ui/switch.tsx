import * as React from "react";
import { Switch as S } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <S.Thumb className="pointer-events-none block size-3.5 rounded-full bg-foreground shadow-sm ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-px" />
    </S.Root>
  );
}
