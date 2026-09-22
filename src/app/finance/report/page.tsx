import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot, type FinancePeriod } from "@/lib/finance";
import { farmLabel } from "@/lib/constants";
import FinanceReport from "@/components/FinanceReport";

import SectionTabs from "@/components/SectionTabs";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinanceReportPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  // Роль нужна только для набора вкладок: у РОПа их меньше — кадровое и
  // служебное ему не показываем (см. tabs.ts).
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;

  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "month";

  const snapshot = await getFinanceSnapshot(period, searchParams.date);
  const farms = snapshot.byFarm.map((f) => ({ ...f, label: farmLabel(f.farm) }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Отчёт по продажам и оплатам</h1>
      </div>

      <SectionTabs tabs={financeTabsFor(role)} />

      <FinanceReport snapshot={snapshot} farms={farms} />
    </div>
  );
}
