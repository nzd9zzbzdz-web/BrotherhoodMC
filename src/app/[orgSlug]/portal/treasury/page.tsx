import { notFound } from "next/navigation";
import { PAGE_W } from "@/lib/page-width";
import { CalendarCheck, Landmark, ScrollText } from "lucide-react";
import { DisplayHeading } from "@/components/theme/DisplayHeading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TreasuryForm } from "@/components/portal/TreasuryForm";
import {
  TreasuryReviewQueue,
  type TreasuryReviewItem,
} from "@/components/portal/TreasuryReviewQueue";
import { requireOrgRole } from "@/lib/auth/session";
import { getOrgBySlug } from "@/lib/tenant";
import { bookOf, canReviewTreasury, isDuesCurrent } from "@/lib/treasury-core";
import {
  TREASURY_BOOKS,
  TREASURY_BOOK_BLURB,
  TREASURY_BOOK_LABEL,
  formatMoney,
} from "@/lib/constants";
import {
  getMember,
  getTreasuryBalances,
  listMembers,
  listTreasuryLedger,
  listTreasuryTransactions,
} from "@/lib/queries";
import type { Timestamp } from "firebase-admin/firestore";
import type { TreasuryTxKind } from "@/lib/types";

const KIND_LABEL: Record<TreasuryTxKind, string> = {
  dues: "Dues payment",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
};

function toDate(value: unknown): Date | null {
  return (value as Timestamp)?.toDate?.() ?? null;
}

function shortDate(value: unknown): string {
  return (
    toDate(value)?.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) ?? ""
  );
}

/**
 * The Club Bank: the running balance, who has paid dues this month, the
 * ledger, and the filing form. Anyone files; the pending queue renders only
 * for admins and the Treasurer, and the action re-checks that server-side.
 */
export default async function TreasuryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const access = await requireOrgRole(org.id, "member");

  const viewer = access.memberId ? await getMember(org.id, access.memberId) : null;
  const mayReview = canReviewTreasury(access.role, viewer?.rankId);

  const [balances, ledger, members, pendingTxs, myTxs] = await Promise.all([
    getTreasuryBalances(org.id),
    listTreasuryLedger(org.id),
    listMembers(org.id),
    mayReview
      ? listTreasuryTransactions(org.id, { status: "pending", limit: 50 })
      : Promise.resolve([]),
    access.memberId
      ? listTreasuryTransactions(org.id, { memberId: access.memberId, limit: 8 })
      : Promise.resolve([]),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));

  const riding = members.filter(
    (m) => m.status !== "retired" && m.status !== "exiled",
  );
  const paidCount = riding.filter((m) => isDuesCurrent(m)).length;

  const queueItems: TreasuryReviewItem[] = pendingTxs.map((t) => ({
    id: t.id,
    kindLabel: KIND_LABEL[t.kind],
    outbound: t.kind === "withdrawal",
    amount: t.amount,
    memberName: memberById.get(t.memberId)?.roadName ?? "Unknown",
    note: t.note,
    date: shortDate(t.createdAt),
    book: bookOf(t),
  }));

  const settled = ledger.filter((t) => t.status !== "pending");

  return (
    <div className={`${PAGE_W.content} space-y-8`}>
      <div>
        <DisplayHeading className="flex items-center gap-3 text-3xl text-foreground md:text-4xl">
          <Landmark className="size-7" aria-hidden />
          Club Bank
        </DisplayHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          Two books, clean and dirty. Dues, deposits and withdrawals are ruled
          on by an admin or the Treasurer, and every approved movement lands on
          the ledger against the book it named.
        </p>
      </div>

      {/* The two numbers the page exists for. They are shown side by side and
          never added up in the headline: the club's own question is always
          "how much of this can we account for", not "how much is there". */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap gap-8">
            {TREASURY_BOOKS.map((b) => (
              <div key={b}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {TREASURY_BOOK_LABEL[b]}
                </p>
                <p className="font-stat mt-1 text-4xl font-bold text-primary">
                  {formatMoney(balances[b])}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {TREASURY_BOOK_BLURB[b]}
                </p>
              </div>
            ))}
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>
              Both books:{" "}
              <span className="font-stat font-semibold text-foreground">
                {formatMoney(balances.total)}
              </span>
            </p>
            <p className="mt-0.5">
              Dues this month:{" "}
              <span className="font-stat font-semibold text-foreground">
                {paidCount} of {riding.length}
              </span>{" "}
              paid
            </p>
            {mayReview && (
              <p className="mt-0.5">
                {pendingTxs.length === 0
                  ? "Nothing waiting on you"
                  : `${pendingTxs.length} movement${pendingTxs.length === 1 ? "" : "s"} waiting for your ruling`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>File a Movement</CardTitle>
          </CardHeader>
          <CardContent>
            {access.memberId ? (
              <TreasuryForm
                orgId={org.id}
                selfMemberId={access.memberId}
                canReview={mayReview}
                members={riding.map((m) => ({
                  id: m.id,
                  label: `"${m.roadName}" · ${m.displayName}`,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Super admin accounts don&apos;t move club money.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3">
          {mayReview ? (
            <TreasuryReviewQueue orgId={org.id} items={queueItems} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>My Filings</CardTitle>
              </CardHeader>
              <CardContent>
                {myTxs.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm font-medium">Nothing filed yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your dues and money movements and their status appear here.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {myTxs.map((t) => (
                      <li key={t.id} className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">
                            {KIND_LABEL[t.kind]} · {formatMoney(t.amount)} ·{" "}
                            {TREASURY_BOOK_LABEL[bookOf(t)].toLowerCase()}
                          </p>
                          <Badge
                            variant={
                              t.status === "approved"
                                ? "default"
                                : t.status === "denied"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {t.status}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {shortDate(t.createdAt)}
                          {t.reviewNote && ` · Reviewer note: ${t.reviewNote}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Who has paid this month — read entirely off the member list. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="size-5 text-muted-foreground" aria-hidden />
            Dues Roll
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Last paid</TableHead>
                  <TableHead className="text-right">This month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riding.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <span className="font-semibold">&ldquo;{m.roadName}&rdquo;</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.displayName}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {shortDate(m.lastDuesPaidAt) || "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {isDuesCurrent(m) ? (
                        <Badge>Paid</Badge>
                      ) : (
                        <Badge variant="outline">Due</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* The bank statement: settled movements with the running balance. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-5 text-muted-foreground" aria-hidden />
            Ledger
          </CardTitle>
        </CardHeader>
        <CardContent>
          {settled.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">No settled movements yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Approved and denied filings appear here, newest first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>Book</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Book balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settled.map((t) => {
                    const denied = t.status === "denied";
                    return (
                      <TableRow key={t.id} className={denied ? "opacity-60" : ""}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {shortDate(t.reviewedAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {KIND_LABEL[t.kind]}
                          {denied && (
                            <Badge variant="destructive" className="ml-2">
                              denied
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {TREASURY_BOOK_LABEL[bookOf(t)]}
                        </TableCell>
                        <TableCell className="text-sm">
                          &ldquo;{memberById.get(t.memberId)?.roadName ?? "Unknown"}&rdquo;
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                          {t.note}
                        </TableCell>
                        <TableCell className="font-stat whitespace-nowrap text-right text-sm">
                          {t.kind === "withdrawal" ? "-" : "+"}
                          {formatMoney(t.amount)}
                        </TableCell>
                        <TableCell className="font-stat whitespace-nowrap text-right text-sm text-muted-foreground">
                          {denied ? "" : formatMoney(t.balanceAfter ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
