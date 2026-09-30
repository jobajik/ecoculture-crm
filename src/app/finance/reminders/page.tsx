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
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import DebtReminderList, { type ReminderRow } from "@/components/DebtReminderList";
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
    orders: g.orders.map((o) => `№ ${o.code} от ${formatDay(o.day)} — ${money(o.debt)}${o.daysLate ? ` · срок прошёл ${o.daysLate} дн. назад` : " · срок сегодня"}`),
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

  return (
    <div className="space-y-5 max-w-4xl">
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
        subtitle={
          [
            plan.recentlyReminded ? `недавно напоминали: ${plan.recentlyReminded}` : "",
            plan.promised ? `обещали заплатить позже: ${plan.promised}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />

      <DebtReminderList rows={rows} canSend={canSend} />

      <Section tone="money" icon="clock" title="Отправленные за 2 недели" flush>
        {recent.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">Пока ни одного.</p>
        ) : (
          <ul className="divide-y divide-line-hairline text-sm">
            {recent.map((r) => (
              <li key={r.reminderId} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3">
                <span className="w-36 text-ink-secondary">{formatMoment(r.sentAt)}</span>
                <span className="flex-1 min-w-0">
                  {r.clientName} · {money(r.amount)}
                  {r.kaspiInvoices && <span className="text-ink-muted"> · со счётом Kaspi</span>}
                </span>
                {r.messageId ? (
                  <span className="text-status-good text-xs">ушло</span>
                ) : (
                  <span className="text-status-critical text-xs">не ушло</span>
                )}
                {r.error && <div className="basis-full text-xs text-[#8a5a00]">{r.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
