import type { Activity, ActivityEntry } from "@/lib/types";

type EntryShape = Pick<Activity, "entries" | "typeId" | "statKey" | "quantity">;

/**
 * Multi-type tickets store an `entries` array; docs from before multi-select
 * carry a single top-level typeId/statKey/quantity. Normalize here so readers
 * and the engine only ever see one shape.
 */
export function activityEntries(activity: EntryShape): ActivityEntry[] {
  if (activity.entries?.length) return activity.entries;
  if (!activity.typeId || !activity.statKey) return [];
  return [
    {
      typeId: activity.typeId,
      statKey: activity.statKey,
      quantity: activity.quantity ?? 1,
    },
  ];
}

/** "Drug Sale ×20 · Felony" — one line for feeds and submission lists. */
export function describeActivity(
  activity: EntryShape,
  nameOf: (typeId: string) => string | undefined,
): string {
  const parts = activityEntries(activity).map((e) => {
    const name = nameOf(e.typeId) ?? e.typeId;
    return e.quantity > 1 ? `${name} ×${e.quantity.toLocaleString("en-US")}` : name;
  });
  return parts.join(" · ") || "Activity";
}
