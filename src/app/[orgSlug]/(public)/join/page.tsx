import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/tenant";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { JoinForm } from "@/components/public/JoinForm";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-16">
      <div>
        <DisplayHeading className="text-4xl text-foreground">Get Involved</DisplayHeading>
        <p className="mt-3 text-muted-foreground">
          Want to ride with us? Send an application below. An officer will review it and reach out.
          Once you&rsquo;re approved you&rsquo;ll have access to the member portal.
        </p>
      </div>

      <JoinForm orgSlug={orgSlug} orgId={org.id} />
    </div>
  );
}
