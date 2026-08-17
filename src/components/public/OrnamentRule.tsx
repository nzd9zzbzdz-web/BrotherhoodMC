/**
 * A hairline broken by a single ember lozenge — the public site's divider.
 *
 * Lives here rather than in the page that first drew it because the About
 * page uses the same motif between its acts, and two hand-copied versions of
 * a house rule is how a house rule stops being one.
 */
export function OrnamentRule({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`} aria-hidden>
      <span
        className="h-px flex-1"
        style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}
      />
      <span className="size-1.5 rotate-45" style={{ background: "var(--primary)" }} />
      <span
        className="h-px flex-1"
        style={{ background: "color-mix(in srgb, var(--accent) 45%, transparent)" }}
      />
    </div>
  );
}
