import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot, type FinancePeriod } from "@/lib/finance";
import FinanceBoard from "@/components/FinanceBoard";
import SectionTabs from "@/components/SectionTabs";
import { FINANCE_TABS } from "./tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PERIODS: { key: FinancePeriod; label: string }[] = [
  { key: "day", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
];

export default async function FinancePage({
  searchParams,
}: {
  searchParams: { period?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const canEdit = role === "accountant" || role === "admin";

  const period = (["day", "week", "month"] as const).includes(searchParams.period as FinancePeriod)
    ? (searchParams.period as FinancePeriod)
    : "day";

  const snapshot = await getFinanceSnapshot(period, searchParams.date);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Оплаты</h1>
          <p className="text-sm text-ink-secondary">
            Заявки менеджеров и отметка об оплате. Две галочки — заявку можно собирать.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/finance?period=${p.key}`}
                className={
                  period === p.key
                    ? "px-3 py-1.5 rounded-lg text-sm bg-accent text-white"
                    : "px-3 py-1.5 rounded-lg text-sm border border-line-hairline text-ink-secondary hover:bg-surface-plane"
                }
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <SectionTabs tabs={FINANCE_TABS} />

      <p className="text-sm text-ink-muted">{snapshot.periodLabel}</p>

      <FinanceBoard snapshot={snapshot} canEdit={canEdit} />
    </div>
  );
}
