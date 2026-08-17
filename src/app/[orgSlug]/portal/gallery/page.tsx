import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { Image as ImageIcon, ShieldCheck } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { GalleryUploader } from "@/components/portal/GalleryUploader";
import { GalleryWall, type GalleryItem } from "@/components/portal/GalleryWall";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { galleryPhotoUrl } from "@/lib/gallery";
import { listGalleryPhotos, listMembers } from "@/lib/queries";
import type { GalleryPhoto } from "@/lib/types";
import type { Timestamp } from "firebase-admin/firestore";

export default async function PortalGalleryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");
  const canReview =
    access.isSuper || access.role === "officer" || access.role === "admin";

  const [photos, members] = await Promise.all([
    listGalleryPhotos(org.id),
    listMembers(org.id),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.roadName]));

  const toItem = (p: GalleryPhoto): GalleryItem => ({
    id: p.id,
    src: galleryPhotoUrl(org.id, p),
    caption: p.caption ?? "",
    width: p.width,
    height: p.height,
    blurDataURL: p.blurDataURL,
    status: p.status,
    visibility: p.visibility,
    uploaderName: nameOf.get(p.uploadedByMemberId) ?? "Unknown",
    uploadedByMemberId: p.uploadedByMemberId,
    takenLabel:
      (p.createdAt as Timestamp)?.toDate?.().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) ?? "",
  });

  // Officers see every pending photo; a member sees only their own waiting.
  // The route enforces the same rule on the bytes, so this isn't the only
  // thing standing between a member and someone else's unreviewed shot.
  const pending = photos
    .filter(
      (p) =>
        p.status === "pending" &&
        (canReview || p.uploadedByMemberId === access.memberId),
    )
    .map(toItem);
  const approved = photos.filter((p) => p.status === "approved").map(toItem);

  const publicCount = approved.filter((p) => p.visibility === "public").length;

  return (
    <div className={`${PAGE_W.gallery} space-y-8`}>
      <div>
        <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
          <ImageIcon className="size-7" aria-hidden />
          Gallery
        </DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          {approved.length === 0
            ? "Ride photos, event shots, and the moments worth keeping."
            : `${approved.length} photo${approved.length === 1 ? "" : "s"} on the wall · ${publicCount} on the public site.`}
        </p>
      </div>

      <GalleryUploader orgId={org.id} canReview={canReview} />

      {pending.length > 0 && (
        <section aria-labelledby="pending-heading" className="space-y-4">
          <div>
            <h2
              id="pending-heading"
              className="flex items-center gap-2 text-lg font-semibold text-foreground"
            >
              <ShieldCheck className="size-5 text-primary" aria-hidden />
              {canReview ? "Awaiting review" : "Your photos awaiting review"}
              <span className="font-stat rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                {pending.length}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {canReview
                ? "Approving puts a photo on the club wall. Publishing it to the foundation site is a separate call."
                : "Only you and the officers can see these until one is cleared."}
            </p>
          </div>
          <GalleryWall
            orgId={org.id}
            items={pending}
            canReview={canReview}
            viewerMemberId={access.memberId}
            emptyMessage="Nothing waiting."
          />
        </section>
      )}

      <section aria-labelledby="wall-heading" className="space-y-4">
        <h2 id="wall-heading" className="sr-only">
          The wall
        </h2>
        <GalleryWall
          orgId={org.id}
          items={approved}
          canReview={canReview}
          viewerMemberId={access.memberId}
          emptyMessage="Nothing on the wall yet. Post the first one."
        />
      </section>
    </div>
  );
}
