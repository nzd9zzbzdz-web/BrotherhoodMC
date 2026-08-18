"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClientAuth } from "@/lib/firebase/client";

function SignInForm({ orgSlug, orgId }: { orgSlug: string; orgId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const showSigninHint = searchParams.get("signin") === "1";

  // Unlike the join form, this door never confirms what is behind it, so the
  // outcome reads the same whether or not the address has an account, and a
  // send failure is swallowed for the same reason.
  async function handleReset() {
    const address = email.trim();
    if (!address) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }
    setError(null);
    setResetState("sending");
    try {
      await sendPasswordResetEmail(getClientAuth(), address);
    } catch {
      // A thrown auth/user-not-found would reveal which addresses exist,
      // which is exactly what the generic copy here avoids.
    }
    setResetState("sent");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const auth = getClientAuth();
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("session");
      const data = (await res.json()) as {
        orgs: Record<string, unknown>;
        superAdmin: boolean;
      };
      // Only members of THIS org (or platform staff) proceed to the portal.
      if (data.superAdmin || data.orgs?.[orgId]) {
        router.push(`/${orgSlug}/portal`);
        router.refresh();
      } else {
        await fetch("/api/auth/session", { method: "DELETE" });
        setError("No volunteer account found for this organization.");
        setPending(false);
      }
    } catch {
      // Deliberately generic — never reveal what exists behind this door.
      setError("Those credentials didn't match our records.");
      setPending(false);
    }
  }

  return (
    <div className="h-fit rounded-lg glass-card p-6">
      <h2 className="flex items-center gap-2 font-semibold text-card-foreground">
        <KeyRound className="size-5 text-primary" aria-hidden />
        Volunteer Portal Sign-In
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        For registered volunteers with portal access.
      </p>
      {showSigninHint && (
        <p role="status" className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Please sign in to continue.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
        <div>
          <label htmlFor="vs-email" className="mb-1 block text-sm font-medium text-card-foreground">
            Email
          </label>
          <input
            id="vs-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="vs-password" className="mb-1 block text-sm font-medium text-card-foreground">
            Password
          </label>
          <input
            id="vs-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {pending ? "Signing in…" : "Sign In"}
        </Button>

        {resetState === "sent" ? (
          <p role="status" className="text-sm text-muted-foreground">
            If that address has an account, a reset link is on its way. Check your spam folder
            if it doesn&rsquo;t arrive.
          </p>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={resetState === "sending"}
            onClick={handleReset}
            className="w-full"
          >
            {resetState === "sending" && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {resetState === "sending" ? "Sending…" : "Forgot your password?"}
          </Button>
        )}
      </form>
    </div>
  );
}

export function VolunteerSignIn(props: { orgSlug: string; orgId: string }) {
  return (
    <Suspense
      fallback={
        <div className="h-64 animate-pulse rounded-lg glass-card" />
      }
    >
      <SignInForm {...props} />
    </Suspense>
  );
}
