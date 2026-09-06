import Link from "next/link";
import { getDailySalesSnapshot } from "@/lib/dailySales";
import DailySalesDashboard from "@/components/DailySalesDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DailySalesPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const snapshot = await getDailySalesSnapshot(searchParams.date);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Продажи за день</h1>
          <p className="text-ink-secondary">
            Кто сколько продал, каких цветов и в какое время. Обновляется автоматически.
          </p>
        </div>
        <Link href="/sales" className="btn-secondary">
          План на месяц →
        </Link>
      </div>

      <DailySalesDashboard initial={snapshot} />
    </div>
  );
}
