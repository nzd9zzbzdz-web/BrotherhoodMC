"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Scroll-in reveal — the one entrance animation the design system allows on
 * in-flow content. Fades up once as the element enters the viewport, then
 * gets out of the way (`once: true` — content must never re-hide on scroll).
 *
 * Motion answers "what just changed": use it on things that ARRIVE (list
 * rows, cards, sections), never on chrome. Stagger by passing index-scaled
 * delays from the call site (`delay={i * 0.05}`) — the prop is serializable,
 * so server components can hand it straight down.
 *
 * Reduced motion renders a plain div: framer would honor the OS setting for
 * transforms anyway, but skipping the motion component entirely also skips
 * the initial opacity: 0 — content is never invisible for a reader who asked
 * for stillness.
 */
export function Reveal({
  children,
  delay = 0,
  y = 12,
  className,
  /** The wrapper element. `li` keeps list semantics valid inside ol/ul. */
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  const Motion = as === "li" ? motion.li : motion.div;
  return (
    <Motion
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </Motion>
  );
}
