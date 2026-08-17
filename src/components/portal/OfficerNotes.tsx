"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { addOfficerNote } from "@/actions/members";

export function OfficerNotes({
  orgId,
  memberId,
  notes,
}: {
  orgId: string;
  memberId: string;
  notes: { id: string; body: string; at: string }[];
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      const result = await addOfficerNote({ orgId, memberId, body: body.trim() });
      if (result.ok) {
        setBody("");
        toast.success("Note added");
      } else {
        toast.error(result.error ?? "Could not add note");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor="officer-note">Add a note</Label>
        <Textarea
          id="officer-note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Observations, warnings, commendations…"
          rows={3}
          maxLength={4000}
        />
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {pending ? "Saving…" : "Add note"}
        </Button>
      </form>

      {notes.length > 0 && (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-secondary/40 p-3">
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
              {note.at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(note.at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
