"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClientAuth } from "@/lib/firebase/client";
import { submitApplication } from "@/actions/applications";

const INPUT =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "mb-1 block text-sm font-medium text-card-foreground";

export function JoinForm({ orgId }: { orgSlug: string; orgId: string }) {
  const [roadName, setRoadName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const auth = getClientAuth();
    let idToken: string;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      idToken = await cred.user.getIdToken();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code === "auth/email-already-in-use"
          ? "An account with this email already exists. If you've already applied, hang tight, or sign in."
          : code === "auth/weak-password"
            ? "Password should be at least 6 characters."
            : code === "auth/invalid-email"
              ? "That doesn't look like a valid email address."
              : "Couldn't create your account. Please try again.",
      );
      setPending(false);
      return;
    }

    const result = await submitApplication({
      orgId,
      idToken,
      roadName: roadName.trim(),
      handle: handle.trim(),
      message: message.trim() || undefined,
    });

    // No portal access is granted yet — sign the applicant out until approved.
    try {
      await signOut(auth);
    } catch {
      // non-fatal
    }

    if (result.ok) {
      setDone(true);
    } else {
      setError(result.error ?? "Something went wrong");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="rounded-lg glass-card p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-primary" aria-hidden />
        <h2 className="mt-3 text-lg font-semibold text-card-foreground">Application sent</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Thanks, &ldquo;{roadName}&rdquo;. An officer will review your application. Once you&rsquo;re
          approved, sign in on the Volunteer Resources page with the email and password you just set.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg glass-card p-6" noValidate>
      <div>
        <label htmlFor="j-road" className={LABEL}>
          Road name / handle you go by
        </label>
        <input id="j-road" required maxLength={40} value={roadName} onChange={(e) => setRoadName(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="j-handle" className={LABEL}>
          Discord or in-game name
        </label>
        <input id="j-handle" required maxLength={60} value={handle} onChange={(e) => setHandle(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="j-email" className={LABEL}>
          Email
        </label>
        <input id="j-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="j-pass" className={LABEL}>
          Choose a password
        </label>
        <input id="j-pass" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        <p className="mt-1 text-xs text-muted-foreground">At least 6 characters. You&rsquo;ll use this to sign in once approved.</p>
      </div>
      <div>
        <label htmlFor="j-msg" className={LABEL}>
          Why do you want to join? <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea id="j-msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} className={`${INPUT} min-h-20 py-2`} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
