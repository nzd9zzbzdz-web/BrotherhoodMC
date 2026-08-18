"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
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
  // Set when the blocker is the password on an account known to exist: the one
  // failure this form can help with, by mailing a reset link.
  const [needsReset, setNeedsReset] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  // Offered only after a failed sign-in, where the account is known to exist,
  // so this discloses nothing the form has not already said. Beyond a
  // forgotten password, the reset also clears Firebase's temporary lockout
  // after repeated failed attempts, which otherwise rejects even the correct
  // password and is indistinguishable from a wrong one.
  async function handleReset() {
    setResetState("sending");
    try {
      await sendPasswordResetEmail(getClientAuth(), email.trim());
      setResetState("sent");
    } catch {
      // Usually throttling. Say so rather than claiming a mail we did not send.
      setResetState("failed");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsReset(false);
    setResetState("idle");
    setPending(true);

    const auth = getClientAuth();
    const address = email.trim();
    let idToken: string;
    try {
      const cred = await createUserWithEmailAndPassword(auth, address, password);
      idToken = await cred.user.getIdToken();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code !== "auth/email-already-in-use") {
        setError(
          code === "auth/weak-password"
            ? "Password should be at least 6 characters."
            : code === "auth/invalid-email"
              ? "That doesn't look like a valid email address."
              : "Couldn't create your account. Please try again.",
        );
        setPending(false);
        return;
      }
      // Clubs on this platform share ONE Firebase auth pool, so an applicant
      // who already rides with another club cannot make a second account under
      // the same email, and does not need one. Everything past this point is
      // already per-club (applications are keyed organizations/{orgId}/{uid},
      // memberships are a map on users/{uid}), so that account is reusable as
      // is: sign in with it and apply as herself. Dead-ending here was the
      // ONLY thing stopping a rider from joining two clubs.
      try {
        const cred = await signInWithEmailAndPassword(auth, address, password);
        idToken = await cred.user.getIdToken();
      } catch (signInErr) {
        // The failed create above already disclosed that the account exists,
        // so the only thing left to say is which password this form wants.
        // One case must be told apart: after repeated failures Firebase
        // temporarily locks the account and rejects even the CORRECT
        // password, and reading the code is the only way to stop that
        // lockout masquerading as one more wrong guess.
        const signInCode = (signInErr as { code?: string })?.code ?? "";
        setError(
          signInCode === "auth/too-many-requests"
            ? "This account is temporarily locked after too many attempts. Wait a few minutes, or reset the password below (the reset also clears the lock)."
            : "This email already has an account, but that isn't its password. Enter that account's password to apply with it, or reset it below.",
        );
        setNeedsReset(true);
        setPending(false);
        return;
      }
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
          approved, sign in on the Volunteer Resources page with that email and password.
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
          Password
        </label>
        <input id="j-pass" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        <p className="mt-1 text-xs text-muted-foreground">
          At least 6 characters, and you&rsquo;ll use it to sign in once approved. If this
          email already has an account with another club on this network, enter that
          account&rsquo;s password instead and we&rsquo;ll attach your application to it.
        </p>
      </div>
      <div>
        <label htmlFor="j-msg" className={LABEL}>
          Why do you want to join? <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea id="j-msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} className={`${INPUT} min-h-20 py-2`} />
      </div>

      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          {needsReset && resetState !== "sent" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resetState === "sending"}
              onClick={handleReset}
            >
              {resetState === "sending" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {resetState === "sending" ? "Sending…" : "Email me a password reset link"}
            </Button>
          )}
          {resetState === "failed" && (
            <p className="text-sm text-muted-foreground">
              Couldn&rsquo;t send the reset link just now. Please try again in a few minutes.
            </p>
          )}
        </div>
      )}

      {resetState === "sent" && (
        <p role="status" className="text-sm text-muted-foreground">
          A reset link is on its way to {email.trim()}. Follow it, set a new password, then come
          back and submit this form with that password. Check your spam folder if it doesn&rsquo;t
          arrive.
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
