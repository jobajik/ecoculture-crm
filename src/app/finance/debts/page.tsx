import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot } from "@/lib/finance";
import { DEBT_OVERDUE_DAYS, SHEET_TABS } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { listDebtReminders } from "@/lib/repo/debtReminders";
import { localDayKey } from "@/lib/timezone";

import Hint from "@/components/Hint";
import PageHeader from "@/components/PageHeader";
import StatTile from "@/components/StatTile";
import CallsBoard from "@/components/CallsBoard";
import { financeTabsFor } from "../tabs";
import { canEditFinance } from "@/lib/financeAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

export default async function DebtsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Право СМОТРЕТЬ и право ТРОГАТЬ разведены: РОП видит долги, но обещания и
  // заметки ставит бухгалтер (src/lib/financeAccess.ts).
  const canEdit = canEditFinance(role);

  // Все нужные вкладки — одним запросом к Google (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.DEBT_REMINDERS,
  ]);
  // Долги считаются по всей базе, поэтому период здесь не важен.
  const [snapshot, reminders] = await Promise.all([getFinanceSnapshot("month"), listDebtReminders()]);
  const { debts } = snapshot;
  // Последнее УШЕДШЕЕ напоминание в WhatsApp по заявке — в колонку «Почему в списке».
  const remindedByOrder = new Map<string, string>();
  for (const r of reminders) {
    if (!r.messageId || !r.sentAt) continue;
    const t = new Date(r.sentAt);
    if (Number.isNaN(t.getTime())) continue;
    const day = localDayKey(t);
    for (const id of r.orderIds) {
      if (day > (remindedByOrder.get(id) ?? "")) remindedByOrder.set(id, day);
    }
  }
  const calls = snapshot.calls.map((c) => ({ ...c, remindedAt: remindedByOrder.get(c.orderId) ?? "" }));
  const broken = calls.filter((c) => c.promiseState === "broken").length;
  const oldest = debts.length > 0 ? Math.max(...debts.map((d) => d.oldestDays)) : 0;

  return (
    <div className="space-y-5">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile label="Всего долг" value={money(snapshot.debtTotal)} sub={`${debts.length} клиентов`} />
        <StatTile
          label="Просрочено"
          value={money(snapshot.debtOverdueTotal)}
          sub={`дольше ${DEBT_OVERDUE_DAYS} дней`}
          tone={snapshot.debtOverdueTotal > 0 ? "critical" : "default"}
        />
        <StatTile
          label="Обещали и не заплатили"
          value={String(broken)}
          sub={broken > 0 ? "позвонить первыми" : "обещания держат"}
          tone={broken > 0 ? "critical" : "default"}
        />
        <StatTile
          label="Самый старый долг"
          value={debts.length > 0 ? `${oldest} дн.` : "—"}
          sub={debts.length > 0 ? "от доставки" : "долгов нет"}
          tone={oldest > DEBT_OVERDUE_DAYS ? "warning" : "default"}
        />
      </div>

      <CallsBoard calls={calls} debts={debts} canEdit={canEdit} />
    </div>
  );
}
