"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, MailPlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createMember, deleteMember, inviteMember, updateMember } from "@/actions/members";
import type { MemberStatus, SystemRole } from "@/lib/types";

interface MemberRow {
  id: string;
  displayName: string;
  roadName: string;
  rankId: string;
  status: MemberStatus;
  memberNumber: number;
  hasAccount: boolean;
  /** Portal role, or null when no account is linked yet. */
  role: SystemRole | null;
  joinDate: string;
  /** Public-site blurb; the only member prose the outside world sees. */
  bio: string;
  /** Overrides the computed tenure caption on the public card. */
  publicLabel: string;
}

interface RankOption {
  id: string;
  name: string;
  isOfficer: boolean;
}

const STATUSES: MemberStatus[] = [
  "hangaround",
  "prospect",
  "patched",
  "retired",
  "exiled",
];

export function MemberAdmin({
  orgId,
  members,
  ranks,
}: {
  orgId: string;
  members: MemberRow[];
  ranks: RankOption[];
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [form, setForm] = useState({
    displayName: "",
    roadName: "",
    rankId: "",
    status: "hangaround" as MemberStatus,
    joinDate: new Date().toISOString().slice(0, 10),
    role: "member" as SystemRole,
    bio: "",
    publicLabel: "",
  });
  const [inviteTarget, setInviteTarget] = useState<MemberRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<SystemRole>("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rankById = new Map(ranks.map((r) => [r.id, r]));

  function openCreate() {
    setEditing(null);
    setForm({
      displayName: "",
      roadName: "",
      rankId: ranks.find((r) => !r.isOfficer)?.id ?? ranks[0]?.id ?? "",
      status: "hangaround",
      joinDate: new Date().toISOString().slice(0, 10),
      role: "member",
      bio: "",
      publicLabel: "",
    });
    setEditorOpen(true);
  }

  function openEdit(member: MemberRow) {
    setEditing(member);
    setForm({
      displayName: member.displayName,
      roadName: member.roadName,
      rankId: member.rankId,
      status: member.status,
      joinDate: member.joinDate,
      role: member.role ?? "member",
      bio: member.bio,
      publicLabel: member.publicLabel,
    });
    setEditorOpen(true);
  }

  function save() {
    startTransition(async () => {
      const payload = {
        orgId,
        displayName: form.displayName.trim(),
        roadName: form.roadName.trim(),
        rankId: form.rankId,
        status: form.status,
        joinDate: new Date(form.joinDate),
        bio: form.bio.trim(),
        publicLabel: form.publicLabel.trim(),
      };
      const roleChanged =
        editing?.hasAccount && editing.role !== null && form.role !== editing.role;
      const result = editing
        ? await updateMember({
            ...payload,
            memberId: editing.id,
            ...(roleChanged ? { role: form.role } : {}),
          })
        : await createMember(payload);
      if (result.ok) {
        toast.success(editing ? "Member updated" : "Member created");
        setEditorOpen(false);
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  }

  function sendInvite() {
    if (!inviteTarget) return;
    startTransition(async () => {
      const result = await inviteMember({
        orgId,
        memberId: inviteTarget.id,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (result.ok && result.data) {
        setInviteUrl(result.data.inviteUrl);
        toast.success("Invite created");
      } else {
        toast.error(result.error ?? "Invite failed");
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteMember({
        orgId,
        memberId: deleteTarget.id,
        confirmRoadName: deleteConfirm.trim(),
      });
      if (result.ok) {
        toast.success(`"${deleteTarget.roadName}" deleted`);
        setDeleteTarget(null);
        setDeleteConfirm("");
      } else {
        toast.error(result.error ?? "Delete failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden />
          New member
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Portal role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <p className="font-semibold">&ldquo;{member.roadName}&rdquo;</p>
                  <p className="text-xs text-muted-foreground">
                    {member.displayName} · #{member.memberNumber}
                  </p>
                </TableCell>
                <TableCell>{rankById.get(member.rankId)?.name ?? "-"}</TableCell>
                <TableCell className="capitalize">{member.status}</TableCell>
                <TableCell>
                  {member.hasAccount ? (
                    <Badge
                      variant={member.role === "admin" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {member.role === "admin" ? "Admin" : member.role}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No account</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(member)}>
                      Edit
                    </Button>
                    {!member.hasAccount && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInviteTarget(member);
                          setInviteEmail("");
                          setInviteRole("member");
                          setInviteUrl(null);
                        }}
                      >
                        <MailPlus className="size-3.5" aria-hidden />
                        Invite
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${member.roadName}`}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        setDeleteTarget(member);
                        setDeleteConfirm("");
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit "${editing.roadName}"` : "New member"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Rank changes are logged to the service record."
                : "Creates the club record. Send an invite afterwards to link an account."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="member-name">
                  Full name <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="member-name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="member-road">
                  Road name <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="member-road"
                  value={form.roadName}
                  onChange={(e) => setForm({ ...form, roadName: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="member-rank">Rank</Label>
                <Select
                  value={form.rankId}
                  onValueChange={(v) => setForm({ ...form, rankId: v })}
                >
                  <SelectTrigger id="member-rank" className="mt-1 w-full">
                    <SelectValue placeholder="Pick a rank" />
                  </SelectTrigger>
                  <SelectContent>
                    {ranks.map((rank) => (
                      <SelectItem key={rank.id} value={rank.id}>
                        {rank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="member-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as MemberStatus })}
                >
                  <SelectTrigger id="member-status" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((status) => (
                      <SelectItem key={status} value={status} className="capitalize">
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="member-joined">Join date</Label>
              <Input
                id="member-joined"
                type="date"
                value={form.joinDate}
                onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Drives how long they&rsquo;ve been riding on the public site.
              </p>
            </div>

            <div>
              <Label htmlFor="member-public-label">Public card caption</Label>
              <Input
                id="member-public-label"
                value={form.publicLabel}
                maxLength={40}
                onChange={(e) => setForm({ ...form, publicLabel: e.target.value })}
                placeholder={form.joinDate ? "e.g. Founding member" : "e.g. Founding member"}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The line under their picture on the public Brotherhood grid.
                Leave it empty and it writes itself from the join date
                (&ldquo;New to the colors&rdquo;, &ldquo;3 years riding&rdquo;).
              </p>
            </div>

            <div>
              <Label htmlFor="member-bio">Public bio</Label>
              <Textarea
                id="member-bio"
                value={form.bio}
                maxLength={600}
                rows={4}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Rode in from Blaine County with nothing but a wrench and a grudge…"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Shown to the public when someone opens this member on the home
                page. Their road name and rank never leave the portal, so this is
                the only thing written about them out there. {form.bio.length}/600
              </p>
            </div>

            {/* Portal role only means something once an account is linked —
                before that, the invite carries the role. */}
            {editing?.hasAccount && (
              <div>
                <Label htmlFor="member-role">Portal role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as SystemRole })}
                >
                  <SelectTrigger id="member-role" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="officer">Officer</SelectItem>
                    <SelectItem value="admin">Organization Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Portal permissions, separate from club rank. Changing this signs
                  them out of any live session so the new role takes effect.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={
                pending ||
                form.displayName.trim().length < 2 ||
                !form.roadName.trim() ||
                !form.rankId
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {editing ? "Save changes" : "Create member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog
        open={inviteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setInviteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite &ldquo;{inviteTarget?.roadName}&rdquo;</DialogTitle>
            <DialogDescription>
              Generates a one-time signup link (expires in 7 days). Share it through
              a channel you trust.
            </DialogDescription>
          </DialogHeader>
          {inviteUrl ? (
            <div className="space-y-3">
              <p className="text-sm">Invite link created:</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy invite link"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin + inviteUrl);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="invite-email">
                  Email <span aria-hidden="true" className="text-destructive">*</span>
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="invite-role">Portal role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as SystemRole)}
                >
                  <SelectTrigger id="invite-role" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="officer">Officer</SelectItem>
                    <SelectItem value="admin">Organization Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Portal permissions, separate from club rank.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteTarget(null)}>
              {inviteUrl ? "Done" : "Cancel"}
            </Button>
            {!inviteUrl && (
              <Button
                onClick={sendInvite}
                disabled={pending || !inviteEmail.includes("@")}
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Create invite
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog — type-to-confirm, because this one doesn't come back */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleteTarget?.roadName}&rdquo;?</DialogTitle>
            <DialogDescription>
              Permanently removes {deleteTarget?.displayName} and everything tied to
              them: logged activities, earned patches, officer notes, service
              record and cut. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              Looking to remove someone who left the club? <strong>Edit</strong> them
              and set their status to <strong>Retired</strong> or{" "}
              <strong>Exiled</strong> instead. That revokes portal access but keeps
              their history under Past Colors.
            </p>
            <div>
              <Label htmlFor="delete-confirm">
                Type <strong>{deleteTarget?.roadName}</strong> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={
                pending ||
                deleteConfirm.trim().toLowerCase() !==
                  (deleteTarget?.roadName ?? "").toLowerCase()
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
