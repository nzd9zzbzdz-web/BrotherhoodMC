import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Hairline rim + top sheen for the filled badge variants. Both derive from
// currentColor — each variant's own foreground token tints its edge — so no
// tenant color is ever named here and the variants keep their token fills.
const badgeRim =
  "border-[color:color-mix(in_srgb,currentColor_28%,transparent)]"
const badgeSheen =
  "bg-[linear-gradient(180deg,color-mix(in_srgb,currentColor_14%,transparent),transparent_55%)]"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: `${badgeRim} ${badgeSheen} bg-primary text-primary-foreground [a&]:hover:bg-primary/90`,
        secondary: `${badgeRim} ${badgeSheen} bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90`,
        destructive: `${badgeRim} ${badgeSheen} bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90`,
        // outline keeps its --border token (that IS its color); it takes the
        // sheen only. ghost/link stay bare — a rim on a text-shaped badge
        // would read as a button.
        outline: `${badgeSheen} border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground`,
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
