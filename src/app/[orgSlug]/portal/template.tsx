/**
 * Route-entrance for every portal page. A template (not the layout) because
 * Next remounts a template's children per navigation — that remount is what
 * replays the animation, while the layout above it keeps the sidebar, session
 * work, and the anthem player alive across page moves.
 *
 * Pure CSS on purpose: no client boundary, no JS cost, and the global
 * prefers-reduced-motion kill switch in globals.css flattens it for free.
 * The animation fills `both`, so the transform ends at `none` and can't
 * permanently break position:sticky inside page content.
 */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
