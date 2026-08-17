import type { MemberStatus, PatchCategory } from "@/lib/types";

export type TierKey = "officers" | "patched" | "prospects" | "hangarounds";

/**
 * Everything the roster UI needs about one member, flattened and serializable
 * (no Firestore Timestamps) so the server page can hand it to client components.
 */
export interface RosterMember {
  id: string;
  roadName: string;
  displayName: string;
  memberNumber: number;
  rankName: string;
  rankOrder: number;
  isOfficer: boolean;
  isPresident: boolean;
  status: MemberStatus;
  rapStatus?: string;
  patchCount: number;
  joinedLabel: string; // "Mar 2026"
  joinedAtMs: number; // 0 when unknown — sorts last
  imageUrl: string;
  hasRender: boolean; // false ⇒ silhouette fallback, styled as such
  /** `artUrl` is null when the club hasn't uploaded art for that patch. */
  topPatches: { name: string; category: PatchCategory; artUrl: string | null }[];
  tier: TierKey;
}
