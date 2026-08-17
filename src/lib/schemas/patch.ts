import { z } from "zod";
import { STAT_KEYS } from "@/lib/types";

export const patchSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(2).max(60),
  category: z.enum(["activity", "service", "leadership", "recognition", "legendary"]),
  description: z.string().min(5).max(500),
  tier: z.number().int().min(1).max(5).default(1),
  requirement: z
    .object({
      statKey: z.enum(STAT_KEYS),
      threshold: z.number().int().min(1).max(10000),
    })
    .nullable(),
  active: z.boolean().default(true),
  // Emblems are earned like patches but never placed on the cut.
  emblem: z.boolean().default(false),
  defaultPlacement: z.object({
    surface: z.enum(["front", "back"]),
    u: z.number().min(0).max(1),
    v: z.number().min(0).max(1),
    scale: z.number().min(0.2).max(2).default(0.8),
    rotationDeg: z.number().min(-45).max(45).default(0),
  }),
});
export type PatchInput = z.infer<typeof patchSchema>;

export const manualAwardSchema = z.object({
  orgId: z.string().min(1),
  memberId: z.string().min(1),
  patchId: z.string().min(1),
  reason: z.string().min(5).max(500),
});
export type ManualAwardInput = z.infer<typeof manualAwardSchema>;
