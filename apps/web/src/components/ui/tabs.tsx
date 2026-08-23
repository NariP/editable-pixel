import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

export function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex min-h-0 flex-col gap-2", className)}
      orientation={orientation}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit flex-none items-center justify-center text-[var(--muted)] data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "h-9 rounded-lg bg-[var(--panel-2)] p-[3px]",
        line: "h-9 gap-1 bg-transparent"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[12px] font-medium whitespace-nowrap text-[var(--muted)] outline-none transition-[color,box-shadow] hover:text-[var(--paper)] focus-visible:border-[var(--acid)] focus-visible:ring-2 focus-visible:ring-[var(--acid)] disabled:pointer-events-none disabled:opacity-40 group-data-[variant=default]/tabs-list:data-active:border-[var(--line)] group-data-[variant=default]/tabs-list:data-active:bg-[var(--panel-3)] group-data-[variant=default]/tabs-list:data-active:text-[var(--paper)] after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-[var(--acid)] after:opacity-0 after:transition-opacity group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 overflow-y-auto text-sm outline-none", className)}
      {...props}
    />
  );
}

export { tabsListVariants };
