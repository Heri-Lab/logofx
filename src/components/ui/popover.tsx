import * as React from "react";
import { ContextMenu as C, Popover as P, DropdownMenu as D } from "radix-ui";
import { cn } from "@/lib/utils";

const surface =
  "z-50 rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-xl shadow-black/30 backdrop-blur-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export function PopoverContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={sideOffset} className={cn(surface, className)} {...props} />
    </P.Portal>
  );
}

export const DropdownMenu = D.Root;
export const DropdownMenuTrigger = D.Trigger;
export function DropdownMenuContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Content sideOffset={sideOffset} className={cn(surface, "min-w-40", className)} {...props} />
    </D.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof D.Item>) {
  return (
    <D.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export const DropdownMenuSeparator = () => <D.Separator className="-mx-1 my-1 h-px bg-border" />;

/* Context menu (right-click), Figma-style: compact rows with shortcuts on the right. */
const menuItem =
  "flex h-7 cursor-default select-none items-center gap-2 rounded-[4px] px-2 text-[11px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground data-[highlighted]:[&_svg]:text-primary-foreground";
export const ContextMenu = C.Root;
export const ContextMenuTrigger = C.Trigger;
export const ContextMenuSub = C.Sub;
export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof C.Content>) {
  return (
    <C.Portal>
      <C.Content className={cn(surface, "min-w-52 bg-popover", className)} {...props} />
    </C.Portal>
  );
}
export function ContextMenuItem({ className, shortcut, children, ...props }: React.ComponentProps<typeof C.Item> & { shortcut?: string }) {
  return (
    <C.Item className={cn(menuItem, className)} {...props}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[10px] tracking-wide opacity-60">{shortcut}</span>}
    </C.Item>
  );
}
export function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof C.SubTrigger>) {
  return (
    <C.SubTrigger className={cn(menuItem, "data-[state=open]:bg-accent", className)} {...props}>
      {children}
      <span className="ml-auto pl-4 text-muted-foreground">›</span>
    </C.SubTrigger>
  );
}
export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof C.SubContent>) {
  return (
    <C.Portal>
      <C.SubContent className={cn(surface, "min-w-44 bg-popover", className)} {...props} />
    </C.Portal>
  );
}
export const ContextMenuLabel = ({ children }: { children: React.ReactNode }) => (
  <C.Label className="flex h-6 items-center gap-1.5 px-2 text-[10px] font-medium text-muted-foreground">{children}</C.Label>
);
export const ContextMenuSeparator = () => <C.Separator className="-mx-1 my-1 h-px bg-border" />;
