import { getFinanceSnapshot } from "@/lib/finance";
import { DEBT_OVERDUE_DAYS } from "@/lib/constants";

import SectionTabs from "@/components/SectionTabs";
import { FINANCE_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

function dayWord(n: number): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "дней";
  if (o > 1 && o < 5) return "дня";
  if (o === 1) return "день";
  return "дней";
}

export default async function DebtsPage() {
  // Долги считаются по всей базе, поэтому период здесь не важен.
  const snapshot = await getFinanceSnapshot("month");
  const { debts } = snapshot;

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Долги</h1>
        <p className="text-sm text-ink-secondary">
          Неоплаченные заявки по клиентам. Возраст считается от даты доставки; после{" "}
          {DEBT_OVERDUE_DAYS} дней долг помечается как просроченный.
        </p>
      </div>

      <SectionTabs tabs={FINANCE_TABS} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Всего долг</div>
          <div className="text-2xl font-semibold tabular-nums">{money(snapshot.debtTotal)}</div>
          <div className="text-xs text-ink-muted mt-1">{debts.length} клиентов</div>
        </div>
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Просрочено</div>
          <div className="text-2xl font-semibold tabular-nums text-status-critical">
            {money(snapshot.debtOverdueTotal)}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            дольше {DEBT_OVERDUE_DAYS} дней после доставки
          </div>
        </div>
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Самый старый долг</div>
          <div className="text-2xl font-semibold tabular-nums">
            {debts.length > 0 ? Math.max(...debts.map((d) => d.oldestDays)) : 0}
          </div>
          <div className="text-xs text-ink-muted mt-1">дней</div>
        </div>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Телефон</th>
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium text-right">Заявок</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium text-right">Возраст</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d) => (
              <tr
                key={d.clientName}
                className="border-b border-line-hairline last:border-0 hover:bg-surface-plane"
              >
                <td className="px-4 py-2.5 font-medium">{d.clientName}</td>
                <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{d.clientPhone || "—"}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{d.managerName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{d.orders}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(d.amount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={d.overdue ? "text-status-critical font-medium" : "text-ink-secondary"}>
                    {d.oldestDays} {dayWord(d.oldestDays)}
                  </span>
                </td>
              </tr>
            ))}
            {debts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="text-2xl mb-2">✓</div>
                  <p className="font-medium">Долгов нет</p>
                  <p className="text-sm text-ink-secondary mt-1">Все заявки оплачены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
