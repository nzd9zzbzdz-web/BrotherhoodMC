import { notFound } from "next/navigation";
import { HandCoins, PackageOpen, Wrench } from "lucide-react";
import { getBranding, getOrgBySlug } from "@/lib/tenant";
import { resolveBranding } from "@/lib/branding-resolve";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { Button } from "@/components/ui/button";

export default async function DonatePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const branding = resolveBranding(await getBranding(org.id, "public"), "public", org);

  const ways = [
    {
      icon: HandCoins,
      title: "One-Time Gift",
      body: "Every dollar goes directly into food, supplies, and program costs. No salaries, no overhead games.",
      cta: "Give once",
    },
    {
      icon: PackageOpen,
      title: "Supply Donations",
      body: "Non-perishable food, school supplies, and winter gear accepted at our Legion Square center every Saturday.",
      cta: "See what we need",
    },
    {
      icon: Wrench,
      title: "Skills & Time",
      body: "Mechanics, cooks, tutors, drivers: your hands are worth more than money. Join a project crew.",
      cta: "Volunteer",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <DisplayHeading className="text-4xl text-foreground">
          Fuel the Mission
        </DisplayHeading>
        <p className="mt-4 text-lg text-muted-foreground">
          The foundation runs on the generosity of neighbors like you. Choose the
          way that fits. Every contribution moves the community forward.
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {ways.map((way) => (
          <article
            key={way.title}
            className="flex flex-col rounded-lg glass-card p-6"
          >
            <way.icon className="size-8 text-primary" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold text-card-foreground">{way.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
              {way.body}
            </p>
            {/* secondary, not ember: three equal ways to give — this page has
                no single primary action to crown. */}
            <Button type="button" variant="secondary" className="mt-6">
              {way.cta}
            </Button>
          </article>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        The {org.publicName} is a registered community organization in the state of{" "}
        {branding.location}. Donation processing coming soon. Contact us to give today.
      </p>
    </div>
  );
}
