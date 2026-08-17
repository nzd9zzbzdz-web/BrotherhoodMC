import { composeLeaderboard, type LeaderboardCategory } from "@/lib/leaderboard";
import { patchArtUrl } from "@/lib/patch-ladders";
import {
  listAwardsByMember,
  listMembers,
  listMembersWithRender,
  listPatchArtVersions,
  listPatches,
} from "@/lib/queries";
import { CHARACTER_SILHOUETTE } from "@/lib/constants";

/**
 * The I/O half of the standings — composeLeaderboard stays a pure resolver, so
 * the reads and the URL plumbing live here instead.
 *
 * Two surfaces render the same boards (the Standings page in the sidebar and
 * the Standings tab on a member's profile) and both fallback chains below are
 * subtle enough that a second copy would drift: emblem art streams from the art
 * route, never as a data URL, and a set `photoPath` does NOT mean a member has
 * real art. Every query it calls is React-cache()d, so a page already holding
 * members or patches pays nothing extra.
 */
export async function loadLeaderboard(orgId: string): Promise<LeaderboardCategory[]> {
  const [members, awardsByMember, patches, patchArt] = await Promise.all([
    listMembers(orgId),
    listAwardsByMember(orgId),
    listPatches(orgId),
    listPatchArtVersions(orgId),
  ]);

  // Existence only for the renders — avatars stream from the render route like
  // the roster's do.
  const withRender = await listMembersWithRender(
    orgId,
    members.map((m) => m.id),
  );

  return composeLeaderboard({
    members,
    awardsByMember,
    patches,
    artUrlFor: (patchId) => patchArtUrl(orgId, patchId, patchArt),
    imageFor: (id) => {
      if (withRender.has(id)) {
        return { url: `/api/orgs/${orgId}/members/${id}/render`, hasRender: true };
      }
      // The seeder writes the shared silhouette into photoPath when a member
      // has no art file, so a set photoPath alone doesn't mean they have one.
      const own = members.find((m) => m.id === id)?.photoPath;
      const ownArt = own && own !== CHARACTER_SILHOUETTE ? own : undefined;
      return { url: ownArt ?? CHARACTER_SILHOUETTE, hasRender: Boolean(ownArt) };
    },
  });
}
