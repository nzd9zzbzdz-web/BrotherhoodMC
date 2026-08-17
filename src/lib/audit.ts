import "server-only";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

/** Fire-and-forget org-scoped audit entry (also usable inside transactions via txAudit). */
export async function writeAuditLog(
  orgId: string,
  entry: { actorUid: string; action: string; targetPath: string; detail?: string },
): Promise<void> {
  await adminDb.collection(`organizations/${orgId}/auditLogs`).add({
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}

export async function writePlatformAuditLog(entry: {
  actorUid: string;
  action: string;
  targetOrgId?: string;
  detail?: string;
  impersonating?: string;
}): Promise<void> {
  await adminDb.collection("platformAuditLogs").add({
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}
