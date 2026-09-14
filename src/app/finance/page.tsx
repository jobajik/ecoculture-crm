import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot, type FinancePeriod } from "@/lib/finance";
import FinanceBoard from "@/components/FinanceBoard";
import SectionTabs from "@/components/SectionTabs";
import { financeTabsFor } from "./tabs";
import { canEditFinance } from "@/lib/financeAccess";

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
  // Смотреть могут трое (бухгалтер, админ, РОП), менять — только двое.
  // Разведено намеренно: у одной записи одна дверь, иначе за неразнесённую
  // оплату спросить будет не с кого (src/lib/financeAccess.ts).
  const canEdit = canEditFinance(role);

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

      <SectionTabs tabs={financeTabsFor(role)} />

      <p className="text-sm text-ink-muted">{snapshot.periodLabel}</p>

      {/* Человеку, у которого нет кнопок, надо сказать ПОЧЕМУ. Иначе он решит,
          что сайт сломался, — ровно так и вышло у бухгалтера, когда права
          пропали из-за сбоя связи с таблицей (грабли 1.14). */}
      {!canEdit && (
        <p className="text-sm text-ink-secondary bg-surface-plane rounded-lg px-3 py-2">
          Раздел открыт вам <b>на просмотр</b>: видно, кто и сколько заплатил, что в долге и по
          каким заявкам ждём денег. Отмечает оплаты и счета бухгалтер — так у одной записи остаётся
          одна дверь.
        </p>
      )}

      <FinanceBoard snapshot={snapshot} canEdit={canEdit} />
    </div>
  );
}
