import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot } from "@/lib/finance";
import { DEBT_OVERDUE_DAYS, ROLES } from "@/lib/constants";

import Hint from "@/components/Hint";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import CallsBoard from "@/components/CallsBoard";
import { financeTabsFor } from "../tabs";
import { canEditFinance } from "@/lib/financeAccess";

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
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Право СМОТРЕТЬ и право ТРОГАТЬ разведены: РОП видит долги, но обещания и
  // заметки ставит бухгалтер (src/lib/financeAccess.ts).
  const canEdit = canEditFinance(role);

  // Долги считаются по всей базе, поэтому период здесь не важен.
  const snapshot = await getFinanceSnapshot("month");
  const { debts, calls } = snapshot;
  const broken = calls.filter((c) => c.promiseState === "broken").length;

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        area="money"
        icon="phone"
        tabs={financeTabsFor(role)}
        title={
          <>
            Долги и звонки
            <span className="font-sans">
              <Hint>
                Долг — неоплаченный остаток по заявке. Возраст — от даты доставки (нет её — от дня
                оформления). Просрочка — дольше {DEBT_OVERDUE_DAYS} дней, по каждой заявке отдельно.
              </Hint>
            </span>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Всего долг</div>
          <div className="font-display text-2xl font-extrabold tabular-nums">{money(snapshot.debtTotal)}</div>
          <div className="text-xs text-ink-muted mt-1">{debts.length} клиентов</div>
        </div>
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Просрочено</div>
          <div className="font-display text-2xl font-extrabold tabular-nums text-status-critical">
            {money(snapshot.debtOverdueTotal)}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            дольше {DEBT_OVERDUE_DAYS} дней
          </div>
        </div>
        <div className="card !p-4">
          <div className="text-xs text-ink-secondary mb-1">Обещали и не заплатили</div>
          <div
            className={
              broken > 0
                ? "font-display text-2xl font-extrabold tabular-nums text-status-critical"
                : "font-display text-2xl font-extrabold tabular-nums"
            }
          >
            {broken}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {debts.length > 0
              ? `самый старый долг — ${Math.max(...debts.map((d) => d.oldestDays))} дн.`
              : "долгов нет"}
          </div>
        </div>
      </div>

      <CallsBoard calls={calls} canEdit={canEdit} />

      <Section tone="money" icon="client" title="Сколько должен каждый клиент" flush className="!mb-0">
        <div className="table-scroll table-cards">
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
                  <td data-label="Телефон" className="px-4 py-2.5 text-ink-secondary tabular-nums">{d.clientPhone || "—"}</td>
                  <td data-label="Менеджер" className="px-4 py-2.5 text-ink-secondary">{d.managerName}</td>
                  <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{d.orders}</td>
                  {/* Под суммой — сколько из неё просрочено. Без этой строки
                      карточка «Просрочено» сверху была бы числом, которое в
                      таблице не найти, а такие числа читаются как ошибка. */}
                  <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {money(d.amount)}
                    {d.overdueAmount > 0 && d.overdueAmount < d.amount - 1 && (
                      <div className="text-xs font-normal text-status-critical">
                        из них просрочено {money(d.overdueAmount)}
                      </div>
                    )}
                  </td>
                  <td data-label="Возраст" className="px-4 py-2.5 text-right tabular-nums">
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
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
