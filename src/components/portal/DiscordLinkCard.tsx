"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createDiscordLinkCode, unlinkDiscord } from "@/actions/discord";

/**
 * Dashboard card for the Discord link. Generating a code is client state (the
 * code is secret-ish and shown once); the linked/unlinked status itself is a
 * server prop, refreshed by the unlink action's revalidate or by the member
 * reloading after running /link in Discord.
 */
export function DiscordLinkCard({
  orgId,
  linked,
  username,
}: {
  orgId: string;
  linked: boolean;
  username: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const res = await createDiscordLinkCode(orgId);
      if (res.ok && res.data) setCode(res.data.code);
      else toast.error(res.error ?? "Could not create a code");
    });
  }

  function sever() {
    startTransition(async () => {
      const res = await unlinkDiscord(orgId);
      if (res.ok) {
        setCode(null);
        toast.success("Discord unlinked");
      } else {
        toast.error(res.error ?? "Could not unlink");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4 text-primary" aria-hidden />
          Discord
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linked ? (
          <div>
            <p className="text-sm text-foreground">
              Linked to{" "}
              <span className="font-semibold">
                {username ? `@${username}` : "your Discord account"}
              </span>
              . Run /mystats in the club server to see your record.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={sever}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Unlink className="size-4" aria-hidden />
              )}
              Unlink
            </Button>
          </div>
        ) : code ? (
          <div>
            <p className="font-mono text-2xl font-semibold tracking-widest text-foreground">
              {code}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              In the club Discord, run /link code:{code} within 10 minutes.
              Then reload this page.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={generate}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              New code
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground">
              Link your Discord account to check your record with /mystats,
              no road name needed.
            </p>
            <Button className="mt-4" onClick={generate} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Link2 className="size-4" aria-hidden />
              )}
              Generate link code
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
