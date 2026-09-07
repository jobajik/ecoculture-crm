import { getFinanceSnapshot, type FinancePeriod } from "@/lib/finance";
import { farmLabel } from "@/lib/constants";
import FinanceReport from "@/components/FinanceReport";

import SectionTabs from "@/components/SectionTabs";
import { FINANCE_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FinanceReportPage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "month";

  const snapshot = await getFinanceSnapshot(period, searchParams.date);
  const farms = snapshot.byFarm.map((f) => ({ ...f, label: farmLabel(f.farm) }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Отчёт по продажам и оплатам</h1>
        <p className="text-sm text-ink-secondary">
          За день, неделю или месяц. Выгружается в Excel одной кнопкой.
        </p>
      </div>

      <SectionTabs tabs={FINANCE_TABS} />

      <FinanceReport snapshot={snapshot} farms={farms} />
    </div>
  );
}
