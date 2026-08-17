"use client";

import { useState, useTransition } from "react";
import { Globe, Loader2, PencilLine, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveMemberBio } from "@/actions/members";

const MAX = 600;

/**
 * The member's own words — the one thing on this page they write themselves.
 *
 * Editing is a mode rather than an always-live textarea: for everyone reading
 * someone else's profile (which is most views) this is prose, not a form.
 *
 * The "shows on the public site" line is not decoration. This field is read by
 * the public roster, so a member typing here is publishing, and the editor has
 * to say that before they hit save — not after somebody screenshots it.
 */
export function MemberBio({
  orgId,
  memberId,
  bio,
  canEdit,
  isSelf,
  roadName,
}: {
  orgId: string;
  memberId: string;
  bio: string;
  canEdit: boolean;
  /** Changes the empty state's voice: an invitation vs. a note about someone. */
  isSelf: boolean;
  roadName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bio);
  // Server truth, so Cancel restores and Save knows whether anything changed.
  const [saved, setSaved] = useState(bio);

  function submit() {
    startTransition(async () => {
      const result = await saveMemberBio({ orgId, memberId, bio: draft });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save");
        return;
      }
      const applied = draft.trim();
      setSaved(applied);
      setDraft(applied);
      setEditing(false);
      toast.success(applied ? "Bio saved" : "Bio cleared");
    });
  }

  // Nothing written and nobody here can write it — render nothing rather than
  // an empty frame on every profile in the club.
  if (!saved && !canEdit) return null;

  return (
    <section
      aria-label={`About "${roadName}"`}
      className="glass-card rounded-xl p-5 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          {isSelf ? "Your Story" : `About "${roadName}"`}
        </h2>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <PencilLine className="size-4" aria-hidden />
            {saved ? "Edit" : "Write it"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX}
            rows={5}
            autoFocus
            aria-label="Your bio"
            placeholder="Who rides under this name? Where they came from, what they're known for."
          />

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Globe className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              This shows on the club&apos;s public page, not just in here. Save
              it empty to take it back down.
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={submit} disabled={pending || draft.trim() === saved}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDraft(saved);
                setEditing(false);
              }}
            >
              <X className="size-4" aria-hidden />
              Cancel
            </Button>
            <span className="font-stat ml-auto text-xs text-muted-foreground">
              {draft.length}/{MAX}
            </span>
          </div>
        </div>
      ) : saved ? (
        // whitespace-pre-line so paragraph breaks the member typed survive.
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {saved}
        </p>
      ) : (
        <p className="mt-3 text-sm italic text-muted-foreground/70">
          {isSelf
            ? "Nothing written yet. Tell the club who rides under your name."
            : "No story on file yet."}
        </p>
      )}
    </section>
  );
}
