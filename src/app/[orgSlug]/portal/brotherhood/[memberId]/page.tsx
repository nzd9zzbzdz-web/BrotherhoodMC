import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { CharacterArtUploader } from "@/components/portal/CharacterArtUploader";
import { type StagePatch } from "@/components/portal/CharacterStage";
import {
  CharacterStageEditor,
  type EmblemChoice,
} from "@/components/portal/CharacterStageEditor";
import { EmblemLadders } from "@/components/portal/EmblemLadders";
import { Leaderboard } from "@/components/portal/Leaderboard";
import { MemberBio } from "@/components/portal/MemberBio";
import {
  MemberStatsEditor,
  type StatEditGroup,
} from "@/components/portal/MemberStatsEditor";
import { ServiceRecord } from "@/components/portal/ServiceRecord";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { composeLadders, patchArtUrl } from "@/lib/patch-ladders";
import { loadLeaderboard } from "@/lib/leaderboard-data";
import { composeServiceRecord } from "@/lib/service-record";
import { requireOrgRole } from "@/lib/auth/session";
import { orgRef } from "@/lib/firebase/admin";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import {
  getMember,
  listActivityTypes,
  listMemberAwards,
  listPatchArtVersions,
  listPatches,
  listRanks,
  listServiceRecord,
} from "@/lib/queries";
import { CRIMINAL_RECORD_ROWS, STAT_LABELS } from "@/lib/constants";
import { STAT_KEYS } from "@/lib/types";
import { resolveBranding } from "@/lib/branding-resolve";
import type { Timestamp } from "firebase-admin/firestore";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; memberId: string }>;
}) {
  const { orgSlug, memberId } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");
  const isSelf = access.memberId === memberId;
  // Uploading someone ELSE's render stays admin-only. Your own is yours, but a
  // plain member's upload waits on an officer before the public roster shows
  // it — see uploadCharacterRender.
  const canManageArt = access.role === "admin";
  // Correcting a stat by hand is the one way a number goes DOWN, and it can
  // take an emblem back with it. Admins only, re-gated in saveMemberStats.
  const canEditStats = access.role === "admin";
  const needsApproval =
    isSelf && !access.isSuper && access.role !== "admin" && access.role !== "officer";
  // Standing on your own mark and writing your own story are yours. Both are
  // re-gated server-side by requireSelfOrRole — this only decides what renders.
  const canEditSelf = canManageArt || isSelf;

  const member = await getMember(org.id, memberId);
  if (!member) notFound();

  // Website-uploaded render (data URL in a subdoc) wins over seeded art.
  const assetSnap = await orgRef(org.id)
    .collection("members")
    .doc(memberId)
    .collection("assets")
    .doc("character")
    .get();
  const uploadedArt = assetSnap.exists
    ? (assetSnap.data()?.dataUrl as string | undefined)
    : undefined;
  // Absent ⇒ approved (everything from before self-service was admin-authored).
  const artApproved = assetSnap.exists ? assetSnap.data()?.approved !== false : true;

  // Standings ride along in the same batch: loadLeaderboard reads members and
  // awards the profile doesn't otherwise need, and awaiting it after this
  // Promise.all would cost a serial round-trip for nothing.
  const [
    ranks,
    awards,
    patches,
    branding,
    career,
    sponsor,
    patchArt,
    leaderboard,
    activityTypes,
  ] = await Promise.all([
    listRanks(org.id),
    listMemberAwards(org.id, memberId),
    listPatches(org.id),
    getBranding(org.id, "portal"),
    listServiceRecord(org.id, memberId),
    member.sponsorMemberId
      ? getMember(org.id, member.sponsorMemberId)
      : Promise.resolve(null),
    listPatchArtVersions(org.id),
    loadLeaderboard(org.id),
    // Only the correction editor needs these, and it only renders for admins.
    canEditStats ? listActivityTypes(org.id) : Promise.resolve([]),
  ]);
  const rank = ranks.find((r) => r.id === member.rankId);
  const patchById = new Map(patches.map((p) => [p.id, p]));
  const brand = resolveBranding(branding, "portal", org);

  // Top patches for the stage's diamond slots — rarest first, then tier.
  const rarityWeight = { legendary: 4, epic: 3, rare: 2, common: 1 } as const;
  const stagePatches: StagePatch[] = awards
    .map((award) => ({ award, patch: patchById.get(award.patchId) }))
    .filter((x): x is { award: (typeof awards)[number]; patch: NonNullable<ReturnType<typeof patchById.get>> } => Boolean(x.patch))
    .sort(
      (a, b) =>
        rarityWeight[b.patch.rarity ?? "common"] -
          rarityWeight[a.patch.rarity ?? "common"] ||
        b.patch.tier - a.patch.tier,
    )
    .slice(0, 4)
    .map(({ award, patch }) => {
      const awardedAt = (award.awardedAt as Timestamp)?.toDate?.();
      return {
        patchId: patch.id,
        name: patch.name,
        description: patch.description,
        category: patch.category,
        awardedLabel: awardedAt
          ? `Earned ${awardedAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
          : "Earned",
        // URL only — the bytes stream from the art route, so four patches don't
        // cost four data URLs in this page's HTML.
        artUrl: patchArtUrl(org.id, patch.id, patchArt),
      };
    });

  // Every profile gets a Criminal Record, built from the stats that approved
  // activity logs move. New members start clean at zero rather than blank.
  // Plain counts stay numeric so the panel counts them up on load; formatted
  // rows (jail time, dirty money) render as their display string.
  const panelStats = CRIMINAL_RECORD_ROWS.map((row) => {
    const value = member.stats?.[row.statKey] ?? 0;
    return {
      label: row.label,
      value: row.format ? row.format(value) : value,
      danger: row.danger,
    };
  });

  // The same rows, opened up for correction. Criminal record is always the
  // whole panel; the club stats show what the club still logs plus any retired
  // key that carries history, so a dead stat with a value can still be fixed.
  const criminalKeys = new Set(CRIMINAL_RECORD_ROWS.map((row) => row.statKey));
  const liveStatKeys = new Set(
    activityTypes.filter((type) => type.active).map((type) => type.statKey),
  );
  const statGroups: StatEditGroup[] = canEditStats
    ? [
        {
          title: "Criminal Record",
          rows: CRIMINAL_RECORD_ROWS.map((row) => {
            const value = member.stats?.[row.statKey] ?? 0;
            return {
              statKey: row.statKey,
              label: row.label,
              value,
              ...(row.format ? { display: row.format(value) } : {}),
            };
          }),
        },
        {
          title: "Club Activity",
          rows: STAT_KEYS.filter(
            (key) =>
              !criminalKeys.has(key) &&
              (liveStatKeys.has(key) || (member.stats?.[key] ?? 0) > 0),
          ).map((key) => ({
            statKey: key,
            label: STAT_LABELS[key] ?? key,
            value: member.stats?.[key] ?? 0,
          })),
        },
      ].filter((group) => group.rows.length > 0)
    : [];

  const careerItems = composeServiceRecord({
    memberNumber: member.memberNumber,
    joinDate: member.joinDate,
    awards,
    patchById,
    career,
    artUrlFor: (patchId) => patchArtUrl(org.id, patchId, patchArt),
  });

  // Emblem progression: the criminal record grouped into a five-rung ladder per
  // stat, so the tab reads as levels climbed rather than a flat list of names.
  // Emblems never reach the cut — this tab is the only place they live.
  const ladders = composeLadders({ patches, awards, stats: member.stats });

  // Everything this member may pin on their stage: every earned emblem rung,
  // plus the patches they actually wear. The action re-checks earned-ness on
  // save; this list only decides what the picker offers.
  const fmtEarned = (d: Date | null | undefined) =>
    d
      ? `Earned ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : "Earned";
  const emblemChoices: EmblemChoice[] = [
    ...ladders.flatMap((l) =>
      l.tiers
        .filter((t) => t.earned)
        .map((t) => ({
          kind: "emblem" as const,
          patchId: t.patch.id,
          name: t.patch.name,
          description: t.patch.description,
          category: t.patch.category,
          awardedLabel: fmtEarned(t.awardedAt),
          artUrl: patchArtUrl(org.id, t.patch.id, patchArt),
        })),
    ),
    ...awards
      .map((award) => ({ award, patch: patchById.get(award.patchId) }))
      .filter(
        (x): x is { award: (typeof awards)[number]; patch: NonNullable<ReturnType<typeof patchById.get>> } =>
          Boolean(x.patch) && x.patch?.emblem !== true,
      )
      .sort(
        (a, b) =>
          rarityWeight[b.patch.rarity ?? "common"] -
            rarityWeight[a.patch.rarity ?? "common"] ||
          b.patch.tier - a.patch.tier,
      )
      .map(({ award, patch }) => ({
        kind: "patch" as const,
        patchId: patch.id,
        name: patch.name,
        description: patch.description,
        category: patch.category,
        awardedLabel: fmtEarned((award.awardedAt as Timestamp)?.toDate?.()),
        artUrl: patchArtUrl(org.id, patch.id, patchArt),
      })),
  ];

  return (
    <div className={`${PAGE_W.gallery} space-y-8`}>
      {/* Stage + its uploader are one block — the uploader is an adjunct
          control that stays tight under the stage, outside the page rhythm. */}
      <div>
        <CharacterStageEditor
          orgId={org.id}
          memberId={memberId}
          canEdit={canEditSelf}
          initialPose={member.characterPose}
          initialEmblems={member.characterEmblems ?? null}
          emblemChoices={emblemChoices}
          orgName={brand.name}
          tagline={brand.tagline}
          roadName={member.roadName}
          displayName={member.displayName}
          memberNumber={member.memberNumber}
          rankName={rank?.name ?? "Unranked"}
          statusLabel={member.rapStatus ?? member.status}
          panelTitle="Criminal Record"
          stats={panelStats}
          patches={stagePatches}
          stagePath={brand.assets.characterStage}
          characterPath={uploadedArt ?? member.photoPath ?? brand.assets.defaultAvatar}
        />
        {canEditSelf && (
          <div className="mt-3">
            <CharacterArtUploader
              orgId={org.id}
              memberId={memberId}
              hasCustomArt={Boolean(uploadedArt)}
              awaitingReview={Boolean(uploadedArt) && !artApproved}
              needsApproval={needsApproval}
            />
          </div>
        )}
      </div>

      <MemberBio
        orgId={org.id}
        memberId={memberId}
        bio={member.bio ?? ""}
        canEdit={canEditSelf}
        isSelf={isSelf}
        roadName={member.roadName}
      />

      {canEditStats && statGroups.length > 0 && (
        <MemberStatsEditor
          orgId={org.id}
          memberId={memberId}
          roadName={member.roadName}
          groups={statGroups}
        />
      )}

      <Tabs defaultValue="service" className="gap-4">
        <TabsList>
          <TabsTrigger value="service">Service Record</TabsTrigger>
          <TabsTrigger value="emblems">
            Emblems
            <span className="font-stat ml-1.5 text-xs text-muted-foreground">
              {ladders.reduce((n, l) => n + l.earnedCount, 0)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
        </TabsList>

        <TabsContent value="service">
          <ServiceRecord
            items={careerItems}
            roadName={member.roadName}
            sponsor={
              sponsor
                ? {
                    roadName: sponsor.roadName,
                    href: `/${orgSlug}/portal/brotherhood/${sponsor.id}`,
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="emblems">
          <EmblemLadders
            ladders={ladders}
            roadName={member.roadName}
            isSelf={access.memberId === memberId}
            orgId={org.id}
            artVersions={patchArt}
          />
        </TabsContent>

        <TabsContent value="standings">
          <Leaderboard
            categories={leaderboard}
            orgSlug={orgSlug}
            subjectMemberId={memberId}
            viewerMemberId={access.memberId ?? null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
