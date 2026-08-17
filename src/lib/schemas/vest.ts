import { z } from "zod";

const categoryEnum = z.enum([
  "activity",
  "service",
  "leadership",
  "recognition",
  "legendary",
]);

export const slotSchema = z.object({
  slot: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "Slot names use A-Z, 0-9 and underscores"),
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
  maxScale: z.number().min(0.2).max(2),
  accepts: z.array(categoryEnum),
  capacity: z.number().int().min(1).max(20),
});

export const saveVestConfigSchema = z.object({
  orgId: z.string().min(1),
  surface: z.enum(["front", "back"]),
  slots: z.array(slotSchema).max(40),
});
export type SaveVestConfigInput = z.infer<typeof saveVestConfigSchema>;
