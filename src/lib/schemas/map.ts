import { z } from "zod";
import { MAP_PIN_KEYS } from "@/lib/map/constants";

// u/v are clamped server-side to [0,1] so a forged payload can never place
// geometry outside the map surface (same guard as vest slot coordinates).
const pointSchema = z.object({
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
});

export const saveMapMarkerSchema = z.object({
  orgId: z.string().min(1),
  markerId: z.string().min(1).max(80).optional(), // absent ⇒ create
  label: z.string().trim().min(1, "Give the pin a label").max(80),
  style: z.enum(MAP_PIN_KEYS),
  description: z.string().trim().max(1000).optional(),
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
});
export type SaveMapMarkerInput = z.infer<typeof saveMapMarkerSchema>;

export const deleteMapMarkerSchema = z.object({
  orgId: z.string().min(1),
  markerId: z.string().min(1).max(80),
});
export type DeleteMapMarkerInput = z.infer<typeof deleteMapMarkerSchema>;

export const saveMapTerritorySchema = z.object({
  orgId: z.string().min(1),
  territoryId: z.string().min(1).max(80).optional(), // absent ⇒ create
  crewName: z.string().trim().min(1, "Name the crew that holds this turf").max(60),
  label: z.string().trim().max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value")
    .nullable(),
  points: z.array(pointSchema).min(3, "A turf zone needs at least 3 points").max(100),
});
export type SaveMapTerritoryInput = z.infer<typeof saveMapTerritorySchema>;

export const deleteMapTerritorySchema = z.object({
  orgId: z.string().min(1),
  territoryId: z.string().min(1).max(80),
});
export type DeleteMapTerritoryInput = z.infer<typeof deleteMapTerritorySchema>;
