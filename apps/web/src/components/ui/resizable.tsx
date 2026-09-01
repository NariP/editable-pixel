import type { ComponentProps } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { TbGripHorizontal } from "react-icons/tb";

import { cn } from "../../lib/utils.js";

export { useDefaultLayout as useResizableDefaultLayout };

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group data-slot="resizable-panel-group" className={cn(className)} {...props} />;
}

export function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

export function ResizableHandle({ className, withHandle = false, ...props }: ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator data-slot="resizable-handle" className={cn(className)} {...props}>
      {withHandle && <span data-slot="resizable-handle-grip" aria-hidden="true"><TbGripHorizontal /></span>}
    </Separator>
  );
}
