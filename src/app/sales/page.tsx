import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getLeaderboard, ownLeaderboard } from "@/lib/leaderboard";
import type { FinancePeriod } from "@/lib/finance";
import Leaderboard from "@/components/Leaderboard";
import PageHeader from "@/components/PageHeader";
import { salesTabsFor } from "./tabs";
import { localDayKey } from "@/lib/timezone";
import { cityScopeOf } from "@/lib/cityScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Менеджер, посаженный в город, видит только своё (`cityScope.ts`).
  const scope = cityScopeOf(session?.user);
  const city = scope !== "";
  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "month";

  const board = await getLeaderboard(period, searchParams.date);
  // Менеджер города видит только свою строку: выручка и бонусы остальных — не его (`cityScope.ts`).
  const snapshot = city ? ownLeaderboard(board, session?.user?.email ?? "") : board;

  return (
    <div>
      <PageHeader area="sales" title={city ? "Мои продажи и бонус" : "Рейтинг менеджеров"} icon="trophy" tabs={salesTabsFor(role, city)} />

      <Leaderboard snapshot={snapshot} currentEmail={session?.user?.email?.toLowerCase() ?? ""} today={localDayKey()} solo={city} />
    </div>
  );
}
