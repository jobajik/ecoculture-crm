import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getLeaderboard } from "@/lib/leaderboard";
import type { FinancePeriod } from "@/lib/finance";
import Leaderboard from "@/components/Leaderboard";
import SectionTabs from "@/components/SectionTabs";
import { SALES_TABS } from "./tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "month";

  const snapshot = await getLeaderboard(period, searchParams.date);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Рейтинг менеджеров</h1>
        <p className="text-sm text-ink-secondary">
          Кто сколько продал и какой бонус заработал. Бонус считается с оплаченных заявок.
        </p>
      </div>

      <SectionTabs tabs={SALES_TABS} />

      <Leaderboard snapshot={snapshot} currentEmail={session?.user?.email?.toLowerCase() ?? ""} />
    </div>
  );
}
