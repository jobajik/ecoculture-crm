import { getSalesSnapshot } from "@/lib/salesAnalytics";
import SalesDashboard from "@/components/SalesDashboard";
import SectionTabs from "@/components/SectionTabs";
import { SALES_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPlanPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const snapshot = await getSalesSnapshot(searchParams.period);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">План и факт</h1>
        <p className="text-sm text-ink-secondary">
          Выполнение месячного плана. Продажа засчитывается по дате оформления заявки, отменённые
          не учитываются.
        </p>
      </div>

      <SectionTabs tabs={SALES_TABS} />

      <SalesDashboard initial={snapshot} />
    </div>
  );
}
