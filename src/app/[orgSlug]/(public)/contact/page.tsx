import { notFound } from "next/navigation";
import { Clock, Mail, MapPin } from "lucide-react";
import { getOrgBySlug } from "@/lib/tenant";
import { clubPreset } from "@/lib/clubs";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { Button } from "@/components/ui/button";

export default async function ContactPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  // The cover story's own details, per club. A shared default here would put
  // one club's community centre on another club's Contact page.
  const { contact } = clubPreset(org.slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <DisplayHeading className="text-4xl text-foreground">Contact Us</DisplayHeading>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <div className="flex gap-4">
            <MapPin className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-semibold text-foreground">{contact.venue}</p>
              <p className="text-sm text-muted-foreground">
                {contact.addressLines.map((line, i) => (
                  <span key={line}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Clock className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-semibold text-foreground">Open Hours</p>
              <p className="text-sm text-muted-foreground">
                {contact.hours.map((line, i) => (
                  <span key={line}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Mail className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-semibold text-foreground">Write to Us</p>
              <p className="text-sm text-muted-foreground">
                {contact.email ?? `outreach@${orgSlug.replace(/-/g, "")}foundation.org`}
              </p>
            </div>
          </div>
        </div>

        <form className="space-y-4 rounded-lg glass-card p-6">
          <div>
            <label htmlFor="contact-name" className="mb-1 block text-sm font-medium text-card-foreground">
              Your name <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id="contact-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="mb-1 block text-sm font-medium text-card-foreground">
              Email <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="contact-message" className="mb-1 block text-sm font-medium text-card-foreground">
              Message <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <textarea
              id="contact-message"
              name="message"
              rows={5}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" className="w-full">
            Send Message
          </Button>
          <p className="text-xs text-muted-foreground">
            Message delivery coming soon. For now, visit us on Saturdays.
          </p>
        </form>
      </div>
    </div>
  );
}
