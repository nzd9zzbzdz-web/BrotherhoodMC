import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // Recessed, not raised: buttons float above the glass, inputs sink into it
  // (inset shadow, no blur — inputs repeat in forms and table rows). The
  // focus bloom derives from --primary via color-mix, so it rides the
  // inset-shadow/ring/shadow slots alongside the existing focus-visible ring
  // and re-tints per tenant.
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base inset-shadow-[0_2px_4px_rgb(0_0_0/0.3)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--primary)_50%,transparent)]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
