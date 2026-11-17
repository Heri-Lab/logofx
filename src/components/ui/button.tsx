import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/88",
        outline: "border border-input bg-input/20 shadow-xs hover:bg-input/45",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent/70 hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 gap-1.5 px-3",
        icon: "size-9",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

/** Joined buttons, like shadcn's ButtonGroup. */
export function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      className={cn(
        "flex overflow-hidden rounded-md border border-input bg-background/70 shadow-xs backdrop-blur-md *:rounded-none *:border-0 *:shadow-none [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-input",
        className,
      )}
      {...props}
    />
  );
}
