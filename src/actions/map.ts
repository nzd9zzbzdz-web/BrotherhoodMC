"use server";

import { revalidatePath } from "next/cache";
import { revalidateOrgTags } from "@/lib/cache";
import { FieldValue, orgRef } from "@/lib/firebase/admin";
import { requireOrgRole, type OrgAccess } from "@/lib/auth/session";
import { getMember } from "@/lib/queries";
import {
  deleteMapMarkerSchema,
  deleteMapTerritorySchema,
  saveMapMarkerSchema,
  saveMapTerritorySchema,
  type DeleteMapMarkerInput,
  type DeleteMapTerritoryInput,
  type SaveMapMarkerInput,
  type SaveMapTerritoryInput,
} from "@/lib/schemas/map";
import type { ActionResult } from "./activities";

// Club Map permission model:
//   view                 — every portal role (page gate)
//   drop / edit pins     — patched members and up (prospects/hangarounds read-only)
//   delete pins          — officers and admins
//   turf zones (all ops) — officers and admins
// Pins are shared club intel: any patched member may edit any pin, matching
// how the crew actually works a map at church.

/** Patched member, officer, admin, or super — the "may touch pins" gate. */
async function assertPatched(access: OrgAccess, orgId: string): Promise<string | null> {
  if (access.isSuper || access.role !== "member") return null;
  if (!access.memberId) return "No member record";
  const member = await getMember(orgId, access.memberId);
  if (member?.status !== "patched") return "Only patched members can work the map";
  return null;
}

function revalidateMap(orgId: string) {
  revalidateOrgTags(orgId, "map");
  revalidatePath(`/[orgSlug]/portal/map`, "page");
  revalidatePath(`/[orgSlug]/portal`, "page"); // dashboard embed
}

export async function saveMapMarker(
  raw: SaveMapMarkerInput,
): Promise<ActionResult<{ markerId: string }>> {
  const parsed = saveMapMarkerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid marker" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "member");
    const denied = await assertPatched(access, input.orgId);
    if (denied) return { ok: false, error: denied };

    const markers = orgRef(input.orgId).collection("mapMarkers");
    const data = {
      label: input.label,
      style: input.style,
      description: input.description ?? "",
      u: input.u,
      v: input.v,
      updatedAt: FieldValue.serverTimestamp(),
    };

    let markerId: string;
    if (input.markerId) {
      const ref = markers.doc(input.markerId);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, error: "That pin no longer exists" };
      await ref.update(data);
      markerId = ref.id;
    } else {
      const ref = await markers.add({
        ...data,
        createdByMemberId: access.memberId,
        createdAt: FieldValue.serverTimestamp(),
      });
      markerId = ref.id;
    }

    await orgRef(input.orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: input.markerId ? "map.marker.update" : "map.marker.create",
      targetPath: `organizations/${input.orgId}/mapMarkers/${markerId}`,
      detail: `${input.style}: ${input.label}`,
      at: FieldValue.serverTimestamp(),
    });

    revalidateMap(input.orgId);
    return { ok: true, data: { markerId } };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteMapMarker(raw: DeleteMapMarkerInput): Promise<ActionResult> {
  const parsed = deleteMapMarkerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const { orgId, markerId } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const ref = orgRef(orgId).collection("mapMarkers").doc(markerId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "That pin no longer exists" };
    await ref.delete();

    await orgRef(orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "map.marker.delete",
      targetPath: `organizations/${orgId}/mapMarkers/${markerId}`,
      detail: String(snap.get("label") ?? ""),
      at: FieldValue.serverTimestamp(),
    });

    revalidateMap(orgId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function saveMapTerritory(
  raw: SaveMapTerritoryInput,
): Promise<ActionResult<{ territoryId: string }>> {
  const parsed = saveMapTerritorySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid turf zone" };
  }
  const input = parsed.data;

  try {
    const access = await requireOrgRole(input.orgId, "officer");
    const territories = orgRef(input.orgId).collection("mapTerritories");
    const data = {
      crewName: input.crewName,
      label: input.label ?? "",
      color: input.color,
      points: input.points,
      updatedAt: FieldValue.serverTimestamp(),
    };

    let territoryId: string;
    if (input.territoryId) {
      const ref = territories.doc(input.territoryId);
      const snap = await ref.get();
      if (!snap.exists) return { ok: false, error: "That turf zone no longer exists" };
      await ref.update(data);
      territoryId = ref.id;
    } else {
      const ref = await territories.add({
        ...data,
        createdByMemberId: access.memberId,
        createdAt: FieldValue.serverTimestamp(),
      });
      territoryId = ref.id;
    }

    await orgRef(input.orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: input.territoryId ? "map.territory.update" : "map.territory.create",
      targetPath: `organizations/${input.orgId}/mapTerritories/${territoryId}`,
      detail: `${input.crewName} (${input.points.length} pts)`,
      at: FieldValue.serverTimestamp(),
    });

    revalidateMap(input.orgId);
    return { ok: true, data: { territoryId } };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteMapTerritory(
  raw: DeleteMapTerritoryInput,
): Promise<ActionResult> {
  const parsed = deleteMapTerritorySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const { orgId, territoryId } = parsed.data;

  try {
    const access = await requireOrgRole(orgId, "officer");
    const ref = orgRef(orgId).collection("mapTerritories").doc(territoryId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "That turf zone no longer exists" };
    await ref.delete();

    await orgRef(orgId).collection("auditLogs").add({
      actorUid: access.user.uid,
      action: "map.territory.delete",
      targetPath: `organizations/${orgId}/mapTerritories/${territoryId}`,
      detail: String(snap.get("crewName") ?? ""),
      at: FieldValue.serverTimestamp(),
    });

    revalidateMap(orgId);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof Error && e.name === "AuthError") {
    return {
      ok: false,
      error: e.message === "unauthenticated" ? "Sign in required" : "Not permitted",
    };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong" };
}
