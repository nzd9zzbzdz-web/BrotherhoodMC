"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Integer count-up for stat tiles — the number itself is the animation, so
 * a stat "arrives" the way the criminal-record panel already counts on the
 * character screen. Pair with `font-stat` on the parent: tabular numerals
 * keep the layout from shifting while the digits tick.
 *
 * The "don't animate" cases (reduced motion, a zero) are DERIVED rather than
 * pushed into state — rendering `value` directly costs no effect and no
 * cascading render, and it means the number is never briefly wrong for a
 * reader who asked for stillness.
 */
export function CountUp({ value, duration = 800 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const animate = !reduce && value > 0;
  const [shown, setShown] = useState(0);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — fast start, soft landing
      setShown(Math.round(eased * value));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration, animate]);

  return <>{animate ? shown : value}</>;
}
