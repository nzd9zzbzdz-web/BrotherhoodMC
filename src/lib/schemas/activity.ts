import { z } from "zod";
import { STAT_KEYS } from "@/lib/types";
import { MAX_ACTIVITY_QUANTITY } from "@/lib/constants";

const activityEntrySchema = z.object({
  typeId: z.string().min(1),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(
      MAX_ACTIVITY_QUANTITY,
      `Quantity cannot exceed ${MAX_ACTIVITY_QUANTITY.toLocaleString("en-US")}`,
    )
    .default(1),
});

export const submitActivitySchema = z.object({
  orgId: z.string().min(1),
  // One ticket can carry several activity types, each with its own quantity.
  entries: z
    .array(activityEntrySchema)
    .min(1, "Pick at least one activity type")
    .max(20, "Too many activity types on one ticket")
    .refine((es) => new Set(es.map((e) => e.typeId)).size === es.length, {
      message: "Each activity type can only appear once",
    }),
  date: z.coerce.date().max(new Date(Date.now() + 24 * 60 * 60 * 1000), {
    message: "Date cannot be in the future",
  }),
  description: z.string().min(10, "Describe what happened (at least 10 characters)").max(2000),
  witnesses: z.array(z.string()).max(10).default([]),
  proofPath: z.string().max(500).optional(),
});
export type SubmitActivityInput = z.infer<typeof submitActivitySchema>;

export const reviewActivitySchema = z.object({
  orgId: z.string().min(1),
  activityId: z.string().min(1),
  decision: z.enum(["approved", "denied"]),
  reviewNote: z.string().max(1000).optional(),
});
export type ReviewActivityInput = z.infer<typeof reviewActivitySchema>;

export const statKeySchema = z.enum(STAT_KEYS);
