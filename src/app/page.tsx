import { redirect } from "next/navigation";

/**
 * Platform root — until custom domains (M9), send visitors to one org.
 *
 * Which org is deployment configuration, not a code constant. A site pinned to
 * one club sets `ORG_SLUG` and gets this for free; a site hosting several sets
 * `DEFAULT_ORG_SLUG` to pick which one owns the bare domain.
 */
export default function RootPage() {
  redirect(`/${process.env.ORG_SLUG ?? process.env.DEFAULT_ORG_SLUG ?? "brotherhood"}`);
}
