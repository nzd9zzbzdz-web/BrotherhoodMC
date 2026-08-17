"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reviewCharacterRender } from "@/actions/character";

export interface PendingRender {
  memberId: string;
  roadName: string;
  displayName: string;
  imageUrl: string;
}

/**
 * Officer review for member-uploaded character renders.
 *
 * The art is shown full-height rather than as a thumbnail — the whole point of
 * the review is looking at the image, and a 40px avatar can't carry a decision
 * about what goes on the club's public page.
 *
 * Reject deletes the render (see reviewCharacterRender), so it is worded as
 * "Reject" and confirmed, not offered as a soft toggle.
 */
export function RenderReviewQueue({
  orgId,
  orgSlug,
  items,
}: {
  orgId: string;
  orgSlug: string;
  items: PendingRender[];
}) {
  const [pending, startTransition] = useTransition();

  function review(item: PendingRender, approve: boolean) {
    if (
      !approve &&
      !window.confirm(
        `Reject and delete "${item.roadName}"'s character art? They'll need to upload another.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reviewCharacterRender({
        orgId,
        memberId: item.memberId,
        approve,
      });
      if (result.ok) {
        toast.success(approve ? `"${item.roadName}" is live` : "Render rejected");
      } else {
        toast.error(result.error ?? "Could not save that");
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="glass-card rounded-xl p-6 text-sm text-muted-foreground">
        No character art waiting. Members&apos; uploads land here before they
        reach the public page.
      </p>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.memberId} className="glass-card overflow-hidden rounded-xl">
          <div className="relative flex h-64 items-end justify-center bg-[radial-gradient(120%_80%_at_50%_10%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- render route, streamed */}
            <img
              src={item.imageUrl}
              alt={`${item.roadName} character render awaiting review`}
              className="max-h-full w-auto object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.6)]"
            />
          </div>

          <div className="space-y-3 p-4">
            <div className="min-w-0">
              <Link
                href={`/${orgSlug}/portal/brotherhood/${item.memberId}`}
                className="block truncate font-semibold text-foreground underline-offset-4 hover:underline"
              >
                &ldquo;{item.roadName}&rdquo;
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {item.displayName}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => review(item, true)}>
                <Check className="size-4" aria-hidden />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => review(item, false)}
              >
                <X className="size-4" aria-hidden />
                Reject
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
