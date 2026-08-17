import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { ClubMap, type ClubMapMarker, type ClubMapTerritory } from "@/components/portal/map/ClubMap";
import { requireOrgRole } from "@/lib/auth/session";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { resolveBranding } from "@/lib/branding-resolve";
import {
  getMember,
  listMapMarkers,
  listMapTerritories,
  listMembers,
} from "@/lib/queries";

export default async function ClubMapPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  // Pins: patched members and up. Zones + deletes: officers.
  const viewer = access.memberId ? await getMember(org.id, access.memberId) : null;
  const canManage = access.isSuper || access.role !== "member";
  const canEditPins = canManage || viewer?.status === "patched";

  const [rawMarkers, rawTerritories, members, brandingDoc] = await Promise.all([
    listMapMarkers(org.id),
    listMapTerritories(org.id),
    listMembers(org.id),
    getBranding(org.id, "portal"),
  ]);
  const territoryName = resolveBranding(brandingDoc, "portal", org).location;
  const roadNameById = new Map(members.map((m) => [m.id, m.roadName]));

  const markers: ClubMapMarker[] = rawMarkers.map((m) => ({
    id: m.id,
    label: m.label,
    style: m.style,
    description: m.description ?? "",
    u: m.u,
    v: m.v,
    droppedBy: m.createdByMemberId
      ? (roadNameById.get(m.createdByMemberId) ?? null)
      : null,
  }));

  const territories: ClubMapTerritory[] = rawTerritories.map((t) => ({
    id: t.id,
    crewName: t.crewName,
    label: t.label ?? "",
    color: t.color ?? null,
    points: t.points ?? [],
  }));

  return (
    <div className={`${PAGE_W.gallery} space-y-8`}>
      <div>
        <DisplayHeading className="text-3xl text-foreground md:text-4xl">Club Map</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          {canEditPins
            ? `Drop intel pins and track turf across ${territoryName}. The whole club sees this map.`
            : `Club intel across ${territoryName}. Patched members keep this map current.`}
        </p>
      </div>
      <ClubMap
        orgId={org.id}
        markers={markers}
        territories={territories}
        canEditPins={Boolean(canEditPins)}
        canManage={canManage}
      />
    </div>
  );
}
