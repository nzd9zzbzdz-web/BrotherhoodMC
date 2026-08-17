import { notFound } from "next/navigation";
import { BookOpen, FileText, ShieldCheck } from "lucide-react";
import { getOrgBySlug } from "@/lib/tenant";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { VolunteerSignIn } from "@/components/public/VolunteerSignIn";

export default async function VolunteerResourcesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();

  const resources = [
    {
      icon: BookOpen,
      title: "Volunteer Handbook",
      body: "Everything a new volunteer needs to know: expectations, safety guidelines, and program overviews.",
    },
    {
      icon: FileText,
      title: "Liability Waivers",
      body: "Required forms for event participation. Bring a signed copy to your first project day.",
    },
    {
      icon: ShieldCheck,
      title: "Safety Training",
      body: "Food handling, site safety, and youth protection training schedules for active volunteers.",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
      <div>
        <DisplayHeading className="text-4xl text-foreground">
          Volunteer Resources
        </DisplayHeading>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Tools and documents for our registered volunteers. New here? Come see us at
          the community center on any Saturday to get started.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1 xl:grid-cols-2">
          {resources.map((resource) => (
            <article key={resource.title} className="glass-card rounded-xl p-6">
              <resource.icon className="size-7 text-primary" aria-hidden />
              <h2 className="mt-3 font-semibold text-card-foreground">{resource.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {resource.body}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Available at the community center front desk.
              </p>
            </article>
          ))}
        </div>

        {/* The gateway. Looks like a routine volunteer login. */}
        <VolunteerSignIn orgSlug={orgSlug} orgId={org.id} />
      </div>
    </div>
  );
}
