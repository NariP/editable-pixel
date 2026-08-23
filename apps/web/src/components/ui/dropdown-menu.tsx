import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "../../lib/utils.js";

export function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  className,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 min-w-52 origin-[var(--transform-origin)] overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-1 text-[var(--paper)] shadow-[0_18px_60px_rgba(0,0,0,.55)] outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "group flex cursor-default select-none items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 outline-none transition-colors focus:bg-[var(--acid)] focus:text-[var(--ink)] data-disabled:pointer-events-none data-disabled:opacity-40 [&_svg]:shrink-0 [&_svg]:text-lg",
        className
      )}
      {...props}
    />
  );
}
