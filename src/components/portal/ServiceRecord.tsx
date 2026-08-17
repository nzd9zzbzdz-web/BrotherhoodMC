import Link from "next/link";
import { Award, ChevronsUp, Flag, HeartHandshake, Skull } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import type { ServiceRecordItem, ServiceRecordKind } from "@/lib/service-record";

/**
 * A member's club career, below the character stage: who vouched for them, and
 * every milestone since — joined, patched, promoted, retired.
 *
 * The entries are composed by the profile page from three sources the club was
 * already recording but never showed (the serviceRecord subcollection, patch
 * awards, and the join date), so a member who has been around a while sees real
 * history the first time this ships rather than an empty panel.
 *
 * Marker-on-a-rule layout matches the club Timeline page — same language for
 * the same idea, one club-wide and one per member.
 */

export interface SponsorLink {
  roadName: string;
  href: string;
}

const ICONS: Record<ServiceRecordKind, typeof Flag> = {
  joined: Flag,
  patch: Award,
  promotion: ChevronsUp,
  removal: Skull,
};

export function ServiceRecord({
  items,
  sponsor,
  roadName,
}: {
  items: ServiceRecordItem[];
  sponsor: SponsorLink | null;
  roadName: string;
}) {
  return (
    <section
      aria-label="Service Record"
      className="texture-noise glass-card rounded-xl p-6 md:p-8"
    >
      <DisplayHeading as="h2" className="text-2xl text-foreground md:text-3xl">
        Service Record
      </DisplayHeading>
      <p className="mt-1 text-sm text-muted-foreground">
        Every milestone under the colors, in the order it happened.
      </p>

      {sponsor && (
        <p className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          <HeartHandshake className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="text-muted-foreground">Vouched for by</span>
          <Link
            href={sponsor.href}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            &ldquo;{sponsor.roadName}&rdquo;
          </Link>
        </p>
      )}

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing on {roadName}&rsquo;s record yet.
        </p>
      ) : (
        <ol className="relative mt-8 space-y-6 border-l border-primary/30 pl-6">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <li key={item.id} className="relative flex items-start gap-3">
                <span
                  aria-hidden
                  className="absolute -left-[35px] flex size-5 items-center justify-center rounded-full border border-primary/50 bg-card"
                >
                  <Icon className="size-3 text-primary" />
                </span>
                {/* The patch itself, when the club has art for it. Sits beside
                    the row rather than replacing the rail marker — the marker
                    is what keeps the timeline reading as one column. */}
                {item.artUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the art route, already sized
                  <img
                    src={item.artUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="mt-1 size-11 shrink-0 object-contain drop-shadow-[0_0_6px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
                  />
                )}
                <div className="min-w-0">
                  <time
                    dateTime={item.dateISO}
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    {item.dateLabel}
                  </time>
                  <p className="mt-1 font-semibold text-foreground">{item.title}</p>
                  {item.detail && (
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      {item.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
