"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Mail, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { approveApplication, rejectApplication } from "@/actions/applications";
import type { SystemRole } from "@/lib/types";

export interface ApplicationItem {
  id: string;
  roadName: string;
  handle: string;
  email: string;
  message: string;
  submittedAt: string; // ISO
}

export function RecruitmentQueue({
  orgId,
  canElevate,
  items,
}: {
  orgId: string;
  canElevate: boolean;
  items: ApplicationItem[];
}) {
  const [rejectTarget, setRejectTarget] = useState<ApplicationItem | null>(null);
  const [reason, setReason] = useState("");
  const [roleFor, setRoleFor] = useState<Record<string, SystemRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve(item: ApplicationItem) {
    setBusyId(item.id);
    const role = roleFor[item.id] ?? "member";
    startTransition(async () => {
      const result = await approveApplication({ orgId, applicationId: item.id, role });
      if (result.ok) {
        toast.success(`"${item.roadName}" approved. They're in`);
      } else {
        toast.error(result.error ?? "Approval failed");
      }
      setBusyId(null);
    });
  }

  function reject() {
    if (!rejectTarget) return;
    const target = rejectTarget;
    setBusyId(target.id);
    startTransition(async () => {
      const result = await rejectApplication({
        orgId,
        applicationId: target.id,
        reason: reason.trim() || undefined,
      });
      if (result.ok) {
        toast.success("Application declined");
        setRejectTarget(null);
        setReason("");
      } else {
        toast.error(result.error ?? "Failed");
      }
      setBusyId(null);
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Check className="mx-auto size-10 text-primary" aria-hidden />
          <p className="mt-3 font-medium">No pending applications</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New recruits who apply through the public site show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">
                      &ldquo;{item.roadName}&rdquo;
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {item.handle}
                      </span>
                    </p>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="size-3" aria-hidden />
                      {item.email}
                    </p>
                  </div>
                  <time className="text-sm text-muted-foreground">
                    {item.submittedAt &&
                      new Date(item.submittedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                  </time>
                </div>

                {item.message && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
                    {item.message}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {canElevate && (
                    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <UserRound className="size-3.5" aria-hidden />
                      Role
                      <select
                        aria-label={`Role for ${item.roadName}`}
                        value={roleFor[item.id] ?? "member"}
                        onChange={(e) =>
                          setRoleFor((prev) => ({
                            ...prev,
                            [item.id]: e.target.value as SystemRole,
                          }))
                        }
                        className="min-h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="member">Member</option>
                        <option value="officer">Officer</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                  )}
                  <Button
                    onClick={() => approve(item)}
                    disabled={pending && busyId === item.id}
                    className="min-w-28"
                  >
                    {pending && busyId === item.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRejectTarget(item)}
                    disabled={pending && busyId === item.id}
                  >
                    <X className="size-4" aria-hidden />
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this application?</DialogTitle>
            <DialogDescription>
              {rejectTarget && `"${rejectTarget.roadName}" (${rejectTarget.email}) won't get portal access.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-reason">Reason (optional, internal)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Not a fit, no response, duplicate…"
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
