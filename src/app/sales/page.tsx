import Link from "next/link";
import { getSalesSnapshot } from "@/lib/salesAnalytics";
import SalesDashboard from "@/components/SalesDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const snapshot = await getSalesSnapshot(searchParams.period);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Продажи менеджеров</h1>
          <p className="text-ink-secondary">
            Факт против плана. Продажа засчитывается по дате оформления заявки, отменённые заявки не
            учитываются.
          </p>
        </div>
        <Link href="/sales/day" className="btn-secondary">
          Дневной дашборд →
        </Link>
      </div>

      <SalesDashboard initial={snapshot} />
    </div>
  );
}
