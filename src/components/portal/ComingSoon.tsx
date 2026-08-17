import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DisplayHeading } from "@/components/theme/DisplayHeading";

export function ComingSoon({
  icon: Icon,
  title,
  blurb,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  detail: string;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <DisplayHeading className="text-3xl text-foreground">{title}</DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
      </div>
      <Card>
        <CardContent className="py-16 text-center">
          <Icon className="mx-auto size-12 text-primary/60" aria-hidden />
          <p className="mt-4 font-medium text-foreground">Under construction</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </div>
  );
}
