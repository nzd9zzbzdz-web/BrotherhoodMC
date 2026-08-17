import { z } from "zod";

/** Public join form → creates a pending application. */
export const submitApplicationSchema = z.object({
  orgId: z.string().min(1),
  idToken: z.string().min(1),
  roadName: z.string().min(1).max(40),
  handle: z.string().min(1).max(60),
  message: z.string().max(1000).optional(),
});
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;

/** Officer approves an application → creates the member + grants access. */
export const approveApplicationSchema = z.object({
  orgId: z.string().min(1),
  applicationId: z.string().min(1), // == applicant uid
  role: z.enum(["admin", "officer", "member"]).default("member"),
});
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;

export const rejectApplicationSchema = z.object({
  orgId: z.string().min(1),
  applicationId: z.string().min(1),
  reason: z.string().max(1000).optional(),
});
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;
