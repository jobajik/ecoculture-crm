import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditFinance, canSeeFinance } from "@/lib/financeAccess";
import { loadReminderPlan } from "@/lib/debtReminderRunner";
import { listDebtReminders } from "@/lib/repo/debtReminders";
import { REMIND_GAP_DAYS, prettyWaPhone, reminderText } from "@/lib/debtReminder";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { prettyKaspiPhone } from "@/lib/kaspiInvoice";
import PageHeader from "@/components/PageHeader";
import StatTile from "@/components/StatTile";
import Hint from "@/components/Hint";
import DebtReminderList, { type ReminderRow } from "@/components/DebtReminderList";
import SentReminders, { type SentReminderRow } from "@/components/SentReminders";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * «Оплаты → Напоминания»: кому сегодня пора напомнить о деньгах в WhatsApp.
 * Правила — `src/lib/debtReminder.ts`, отправка — `debtReminderRunner.ts`.
 */
export default async function RemindersPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeFinance(role)) redirect("/?error=forbidden");
  const canSend = canEditFinance(role);

  const [plan, history] = await Promise.all([loadReminderPlan(), listDebtReminders()]);
  const rows: ReminderRow[] = plan.due.map((g) => ({
    key: g.key,
    clientName: g.clientName,
    phone: prettyWaPhone(g.waPhone),
    total: money(g.total),
    orders: g.orders.map((o) => ({
      orderId: o.orderId,
      code: o.code,
      text: `от ${formatDay(o.day)} — ${money(o.debt)}${o.daysLate ? ` · срок прошёл ${o.daysLate} дн. назад` : " · срок сегодня"}`,
    })),
    kaspi: g.kaspiNew.length
      ? `выставим счёт Kaspi на ${money(g.kaspiNew.reduce((s, k) => s + k.amount, 0))} · ${prettyKaspiPhone(g.kaspiPhone)}`
      : g.kaspiOpen.length
        ? "счёт Kaspi уже выставлен — напомним про него"
        : "",
    last: g.lastRemindedAt ? formatDay(g.lastRemindedAt) : "",
    problem: g.problem,
    text: reminderText(g, [...g.kaspiOpen, ...g.kaspiNew]),
  }));
  const recent = history
    .filter((r) => Date.now() - new Date(r.sentAt).getTime() < 14 * 86_400_000)
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
    .slice(0, 40);
  const sent: SentReminderRow[] = recent.map((r) => ({
    id: r.reminderId,
    when: formatMoment(r.sentAt),
    text: `${r.clientName} · ${money(r.amount)}${r.kaspiInvoices ? " · со счётом Kaspi" : ""}`,
    ok: !!r.messageId,
    error: r.error,
  }));
  const dueTotal = plan.due.reduce((s, g) => s + g.total, 0);
  const blocked = plan.due.filter((g) => g.problem).length;

  return (
    <div className="space-y-5">
      <PageHeader
        area="money"
        icon="message"
        tabs={financeTabsFor(role)}
        title={
          <>
            Напоминания об оплате
            <span className="font-sans">
              <Hint>
                Здесь клиенты, у которых наступил срок оплаты: доставка плюс отсрочка из карточки клиента. Кто обещал
                заплатить позже, в списке нет. Повторно по той же заявке — не раньше чем через {REMIND_GAP_DAYS} дня.
                Если по хризантеме подключена касса Kaspi, к сообщению сам выставится счёт на остаток.
              </Hint>
            </span>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          label="Пора напомнить"
          value={String(rows.length)}
          sub={rows.length ? money(dueTotal) : "некому"}
          tone={rows.length ? "warning" : "good"}
        />
        <StatTile label="Нельзя отправить" value={String(blocked)} sub={blocked ? "нет мобильного и т. п." : "у всех есть номер"} />
        <StatTile label="Недавно напоминали" value={String(plan.recentlyReminded)} sub={`пауза ${REMIND_GAP_DAYS} дня`} />
        <StatTile label="Обещали позже" value={String(plan.promised)} sub="не трогаем" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <DebtReminderList rows={rows} canSend={canSend} />
        <SentReminders rows={sent} />
      </div>
    </div>
  );
}
