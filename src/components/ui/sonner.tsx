"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Glass-panel idiom without the class: sonner's own (unlayered)
      // stylesheet outranks layered Tailwind utilities for background and
      // border, and richColors repaints both per toast type — so the look
      // comes through sonner's CSS vars (translucent popover bg, hairline
      // foreground-mix border) plus the only things sonner doesn't already
      // set: blur, saturation, and the panel shadow (that one needs `!` to
      // beat sonner's default). richColors toasts keep their tinted
      // bg/border and still pick up the blur + shadow.
      toastOptions={{
        classNames: {
          toast:
            "backdrop-blur-lg backdrop-saturate-125 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_12%,transparent),0_18px_40px_-28px_rgb(0,0,0)]!",
        },
      }}
      style={
        {
          "--normal-bg": "color-mix(in srgb, var(--popover) 82%, transparent)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border":
            "color-mix(in srgb, var(--foreground) 12%, transparent)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
