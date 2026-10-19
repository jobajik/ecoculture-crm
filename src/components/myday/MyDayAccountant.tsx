import Link from "next/link";
import clsx from "clsx";
import type { DayUser } from "@/lib/myDay/greeting";
import { getFinanceSnapshot } from "@/lib/finance";
import { listKaspiInvoices } from "@/lib/repo/kaspiInvoices";
import { listDebtReminders } from "@/lib/repo/debtReminders";
import { buildPaymentStatus } from "@/lib/paymentStatus";
import { getKaspiHealth } from "@/lib/kaspiHealthCheck";
import { configuredFarms } from "@/lib/apipay";
import { canEditFinance } from "@/lib/financeAccess";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { buildAccountantDay, type DayCall } from "@/lib/myDay/accountant";
import DayCard, { DayEmpty, DayRow } from "./DayCard";
import KpiTile from "../KpiTile";
import Pill, { type PillTone } from "../Pill";
import InvoiceCell from "../InvoiceCell";

/**
 * «Мой день» бухгалтера (19.10.2026, макет принят владельцем): кассы Kaspi, четыре цифры, кому звонить, счета без
 * отметки и что пришло сегодня. Цифры — те же, что на страницах «Оплат» (`src/lib/myDay/accountant.ts`), здесь
 * только отбор: что делать первым.
 */
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
const orders = (n: number) => `${n} ${plural(n, "заявка", "заявки", "заявок")}`;

const REASON_TONE: Record<DayCall["reason"], PillTone> = { broken: "bad", overdue: "bad", due_today: "wait" };
const KASPI_TONE: Record<string, PillTone> = { ok: "good", broken: "bad", unknown: "muted", off: "muted" };

export default async function MyDayAccountant({ user }: { user: DayUser }) {
  const canEdit = canEditFinance(user.role);
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.KASPI_INVOICES,
    SHEET_TABS.DEBT_REMINDERS,
  ]);
  const todayKey = localDayKey();
  // Период «день»: касса по цветкам — за сегодня по дню поступления; долги и звонки — по всей базе, как всегда.
  const [snapshot, invoices, reminders, health] = await Promise.all([
    getFinanceSnapshot("day"),
    listKaspiInvoices(),
    listDebtReminders().catch(() => []),
    getKaspiHealth(),
  ]);
  const remindedByOrder = new Map<string, string>();
  for (const r of reminders) {
    if (!r.messageId || !r.sentAt) continue;
    const t = new Date(r.sentAt);
    if (Number.isNaN(t.getTime())) continue;
    const day = localDayKey(t);
    for (const id of r.orderIds) if (day > (remindedByOrder.get(id) ?? "")) remindedByOrder.set(id, day);
  }
  const board = buildPaymentStatus(snapshot.openRows, snapshot.recentPaidRows, invoices, todayKey);
  const day = buildAccountantDay({
    calls: snapshot.calls,
    openRows: snapshot.openRows,
    debtOverdueTotal: snapshot.debtOverdueTotal,
    board,
    cash: snapshot.cash,
    remindedByOrder,
    kaspiHealth: health,
    kaspiConfigured: configuredFarms(),
    todayKey,
  });
  const t = day.tiles;

  return (
    <div className="space-y-5">
      {/* Состояние касс: счёт в Kaspi уходит только с работающей кассы — об этом надо знать до первого счёта. */}
      <div className="flex flex-wrap items-center gap-2">
        {day.kaspi.map((k) => (
          <Pill key={k.farm} tone={KASPI_TONE[k.state] ?? "muted"}>
            {k.text}
          </Pill>
        ))}
        <span className="text-xs text-ink-muted">
          {t.paidToday.count > 0 ? `сегодня ${orders(t.paidToday.count)} с деньгами` : "сегодня денег ещё не было"}
        </span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          icon="wallet"
          label="Пришло сегодня"
          value={money(t.paidToday.amount)}
          hint={t.paidToday.kaspiAmount > 0 ? `из них Kaspi ${money(t.paidToday.kaspiAmount)}` : "по дню поступления"}
          tone={t.paidToday.kaspiAmount > 0 ? "good" : undefined}
          href="/finance/status"
        />
        <KpiTile icon="clock" label="Ждут оплаты" value={money(t.waiting.amount)} hint={`${orders(t.waiting.orders)} · долг по всей базе`} href="/finance/status" />
        <KpiTile
          icon="alert"
          label="Просрочено"
          value={money(t.overdue.amount)}
          hint={
            t.overdue.orders > 0
              ? `${orders(t.overdue.orders)}${t.overdue.brokenPromises > 0 ? ` · ${t.overdue.brokenPromises} ${plural(t.overdue.brokenPromises, "сорванное обещание", "сорванных обещания", "сорванных обещаний")}` : ""}`
              : "просрочки нет"
          }
          tone={t.overdue.orders > 0 ? "bad" : "good"}
          href="/finance/debts"
        />
        <KpiTile
          icon="card"
          label="Kaspi не дошёл"
          value={t.kaspiProblems.count}
          hint={t.kaspiProblems.count > 0 ? `${money(t.kaspiProblems.amount)} · счёт истёк или отклонён — перевыставить` : "все счета у клиентов"}
          tone={t.kaspiProblems.count > 0 ? "warn" : undefined}
          href="/finance/status"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-5 items-start">
        <div className="xl:col-span-3 min-w-0">
          <DayCard
            tone="money"
            icon="phone"
            title="Кому звонить сегодня"
            count={day.callsTotal}
            countTone={day.callsTotal > 0 ? "bad" : "muted"}
            hint="сверху — кто обещал и не заплатил"
            link={{ href: "/finance/debts", label: "Все долги →" }}
          >
            {day.calls.length === 0 && <DayEmpty>Звонить некому: сорванных обещаний и просрочки нет, сроки сегодня ни у кого не вышли.</DayEmpty>}
            {day.calls.map((c) => (
              <DayRow
                key={c.orderId}
                right={
                  <>
                    <span className="font-display font-extrabold text-[15px] tabular-nums text-status-critical whitespace-nowrap">{money(c.debt)}</span>
                    {c.clientPhone && (
                      <a href={`tel:${c.clientPhone.replace(/[^\d+]/g, "")}`} className="btn-secondary !min-h-0 !py-1.5 !px-3 text-[13px]">
                        Позвонить
                      </a>
                    )}
                    <Link href="/finance/reminders" className="btn-secondary !min-h-0 !py-1.5 !px-3 text-[13px]">
                      {c.remindedAt ? `Напомнили ${formatDay(c.remindedAt)}` : "Напомнить в WhatsApp"}
                    </Link>
                  </>
                }
              >
                <div className="font-semibold">
                  {c.clientName}
                  <span className="text-ink-muted font-normal">
                    {" "}
                    · <Link href={`/orders/${encodeURIComponent(c.orderId)}`} className="font-display text-accent hover:underline">№ {c.code}</Link>
                    {c.managerName ? ` · ${c.managerName}` : ""}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                  <Pill tone={REASON_TONE[c.reason]}>{c.why}</Pill>
                </div>
              </DayRow>
            ))}
            {(day.callsTotal > day.calls.length || day.promisedLater > 0) && (
              <div className="px-4 sm:px-5 py-2.5 border-t border-line-hairline text-[13px] text-ink-secondary">
                {day.callsTotal > day.calls.length && <>Ещё {day.callsTotal - day.calls.length} в списке звонков. </>}
                {day.promisedLater > 0 && <>{day.promisedLater} {plural(day.promisedLater, "обещал", "обещали", "обещали")} заплатить позже — скрыты до срока. </>}
                <Link href="/finance/debts" className="text-accent font-semibold">Показать</Link>
              </div>
            )}
          </DayCard>
        </div>

        <div className="xl:col-span-2 min-w-0 space-y-5">
          <DayCard
            tone="money"
            icon="note"
            title="Счета без отметки"
            count={day.invoicesTotal}
            countTone={day.invoicesTotal > 0 ? "wait" : "muted"}
            hint={canEdit ? "отметить — одно нажатие" : undefined}
            link={{ href: "/finance/status", label: "Статус оплат →" }}
          >
            {day.invoices.length === 0 && <DayEmpty>У всех заявок с долгом счёт отмечен или выставлен в Kaspi.</DayEmpty>}
            {day.invoices.map((i) => (
              <DayRow
                key={i.orderId}
                right={
                  <>
                    <span className="font-display font-extrabold text-[14px] tabular-nums whitespace-nowrap">{money(i.debt)}</span>
                    <InvoiceCell orderId={i.orderId} stage={i.row.stage} invoiceSentAt={i.row.invoiceSentAt} invoiceNote={i.row.invoiceNote} canEdit={canEdit} />
                  </>
                }
              >
                <div className="font-semibold truncate">
                  {i.clientName}{" "}
                  <Link href={`/orders/${encodeURIComponent(i.orderId)}`} className="font-display text-accent hover:underline font-normal">
                    № {i.code}
                  </Link>
                </div>
                <div className="text-xs text-ink-muted">
                  {i.days > 0 ? `${i.days} дн. с доставки` : "доставка сегодня"}
                  {i.note ? ` · ${i.note}` : ""}
                </div>
              </DayRow>
            ))}
            {day.invoicesTotal > day.invoices.length && (
              <div className="px-4 sm:px-5 py-2.5 border-t border-line-hairline text-[13px] text-ink-secondary">
                Ещё {day.invoicesTotal - day.invoices.length} — в <Link href="/finance/status" className="text-accent font-semibold">статусе оплат</Link>.
              </div>
            )}
          </DayCard>

          <DayCard tone="good" icon="wallet" title="Пришло сегодня" link={{ href: "/finance", label: "Касса по цветкам →" }}>
            {day.payments.length === 0 && <DayEmpty>Сегодня платежей ещё не было.</DayEmpty>}
            {day.payments.map((p, i) => (
              <DayRow
                key={`${p.orderId}-${i}`}
                right={<span className="font-display font-extrabold text-[14px] tabular-nums whitespace-nowrap">{money(p.amount)}</span>}
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Pill tone={p.viaKaspi ? "bad" : "muted"} dot={false}>
                    {p.viaKaspi ? "Kaspi" : p.method || "способ не указан"}
                  </Pill>
                  <span className="font-semibold truncate">{p.clientName}</span>
                  <Link href={`/orders/${encodeURIComponent(p.orderId)}`} className="font-display text-accent hover:underline text-[13px]">
                    № {p.code}
                  </Link>
                </div>
              </DayRow>
            ))}
            {(day.byFlower.length > 0 || t.paidToday.kaspiAmount > 0) && (
              <div className={clsx("px-4 sm:px-5 py-2.5 border-t border-line-hairline flex flex-wrap items-center justify-between gap-2 text-[13px]")}>
                <span className="text-ink-secondary">{day.byFlower.map((f) => `${f.label} ${money(f.amount)}`).join(" · ")}</span>
                {t.paidToday.kaspiAmount > 0 && (
                  <Pill tone="bad" dot={false}>
                    Kaspi {money(t.paidToday.kaspiAmount)}
                  </Pill>
                )}
              </div>
            )}
          </DayCard>
        </div>
      </div>
    </div>
  );
}
