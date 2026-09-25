import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getLeaderboard } from "@/lib/leaderboard";
import type { FinancePeriod } from "@/lib/finance";
import Leaderboard from "@/components/Leaderboard";
import PageHeader from "@/components/PageHeader";
import { salesTabsFor } from "./tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "month";

  const snapshot = await getLeaderboard(period, searchParams.date);

  return (
    <div className="space-y-5">
      <PageHeader area="sales" title="Рейтинг менеджеров" icon="trophy" tabs={salesTabsFor(role)} />

      <Leaderboard snapshot={snapshot} currentEmail={session?.user?.email?.toLowerCase() ?? ""} />
    </div>
  );
}
