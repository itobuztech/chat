import * as React from "react"

import { cn } from "../../lib/utils"

const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("relative h-full w-full overflow-y-auto", className)}
      {...props}
    />
  ),
)
ScrollArea.displayName = "ScrollArea"

export { ScrollArea }
