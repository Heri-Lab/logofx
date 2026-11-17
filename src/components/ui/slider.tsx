import * as React from "react";
import { Slider as S } from "radix-ui";
import { cn } from "@/lib/utils";

export function Slider({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root className={cn("relative flex h-4 w-full touch-none select-none items-center", className)} {...props}>
      <S.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
        <S.Range className="absolute h-full bg-brand" />
      </S.Track>
      <S.Thumb className="block size-3.5 rounded-full border-2 border-brand bg-foreground shadow-sm outline-none transition-[box-shadow] hover:ring-4 hover:ring-brand/20 focus-visible:ring-4 focus-visible:ring-brand/30" />
    </S.Root>
  );
}
