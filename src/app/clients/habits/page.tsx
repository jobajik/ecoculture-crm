import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { ROLES } from "@/lib/constants";
import { listUsers } from "@/lib/repo/users";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listWaMessages } from "@/lib/repo/talks";
import { listBroadcasts, listRecipients, listWaStatuses, settingsMap } from "@/lib/repo/broadcasts";
import { deliveryByMessage, RECIPIENT_STATE_LABELS } from "@/lib/broadcast";
import { computeHabits } from "@/lib/clientHabitsRunner";
import { HABIT_MODE_LABELS, habitsAnalytics } from "@/lib/habitsAnalytics";
import { WEEKDAYS, usualLabel } from "@/lib/clientHabits";
import { stylesFrom } from "@/lib/managerStyleRunner";
import { HABITS_LAST_RUN } from "@/lib/habitsKick";
import { localDayKey } from "@/lib/timezone";
import { formatDay, formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import KpiTile from "@/components/KpiTile";
import Pill from "@/components/Pill";
import PagedList from "@/components/PagedList";
import { clientsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "—");
const DAYS = 30;

/**
 * «Постоянники» (09.11.2026): кто у менеджера заказывает регулярно, когда ждём следующую заявку, и как идут рассылки
 * постоянникам от имени менеджеров — в его день, по просьбе менеджера, сами (`clientHabitsRunner`, `habitsAnalytics`).
 * Владелец и РОП видят всех, менеджер — своих.
 */
export default async function HabitsPage({ searchParams }: { searchParams?: { manager?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const manage = role === ROLES.ADMIN || role === ROLES.SALES_HEAD;
  if (!manage && role !== ROLES.MANAGER) redirect("/clients");
  const email = (session?.user?.email ?? "").toLowerCase();
  const today = localDayKey();

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.WA_STATUSES, SHEET_TABS.WA_MESSAGES, SHEET_TABS.SETTINGS]);
  const [habitsAll, users, orders, broadcasts, recipients, statuses, messages, map] = await Promise.all([
    computeHabits(today),
    listUsers(),
    listOrdersWithItems(),
    listBroadcasts(),
    listRecipients(),
    listWaStatuses(),
    listWaMessages({ lines: "all" }),
    settingsMap(),
  ]);
  const nameOf = (e: string) => users.find((u) => u.email.toLowerCase() === (e || "").toLowerCase())?.name?.split(/\s+/)[0] || e || "—";
  const managers = Array.from(new Set(habitsAll.filter((h) => h.regular).map((h) => h.managerEmail)));
  const picked = manage ? (searchParams?.manager || "").toLowerCase() : email;
  const habits = habitsAll.filter((h) => h.regular && (!picked || h.managerEmail.toLowerCase() === picked));
  const stats = habitsAnalytics({ broadcasts, recipients, statuses: deliveryByMessage(statuses), messages, orders, nameOf, today, days: DAYS });
  const rows = stats.rows.filter((r) => !picked || r.managerEmail.toLowerCase() === picked);
  const byManager = picked ? stats.byManager.filter((m) => m.managerEmail.toLowerCase() === picked) : stats.byManager;
  const total = picked ? byManager[0] : stats.total;
  const styles = stylesFrom(map);
  const overdue = habits.filter((h) => h.nextExpectedAt && h.nextExpectedAt < today).length;
  const weekly = habits.reduce((s, h) => s + (h.medianGapDays ? (h.avgAmount * 7) / h.medianGapDays : 0), 0);
  const lastRun = map[HABITS_LAST_RUN] || "";

  const habitRows = [...habits]
    .sort((a, b) => b.avgAmount / Math.max(1, b.medianGapDays) - a.avgAmount / Math.max(1, a.medianGapDays))
    .map((h) => {
      const late = h.nextExpectedAt && h.nextExpectedAt < today;
      return (
        <li key={h.clientId} className="px-4 py-3 grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_110px_90px_120px_130px_minmax(0,1.4fr)] lg:items-start text-sm">
          <div className="min-w-0">
            <Link href={`/clients/${h.clientId}`} className="font-medium hover:underline break-words">
              {h.name}
            </Link>
            <div className="text-xs text-ink-muted">
              {nameOf(h.managerEmail)} · заявок {h.orders} · ср. чек {money(h.avgAmount)}
              {!h.active && <span className="text-status-critical"> · выключен</span>}
            </div>
          </div>
          <div className="text-ink-secondary tabular-nums">раз в {h.medianGapDays} дн.</div>
          <div>
            <Pill tone="muted">{WEEKDAYS[h.weekday]}</Pill>
          </div>
          <div className="tabular-nums text-ink-secondary">
            <span className="lg:hidden text-ink-muted">Последняя: </span>
            {formatDay(h.lastAt)}
          </div>
          <div className={late ? "text-status-critical font-semibold tabular-nums" : "tabular-nums text-ink-secondary"}>
            <span className="lg:hidden text-ink-muted">Ждём: </span>
            {formatDay(h.nextExpectedAt)}
            {late && <span className="text-xs block lg:inline"> · молчит</span>}
            {h.lastSentAt && <div className="text-xs text-ink-muted font-normal">писали {formatDay(h.lastSentAt)}</div>}
          </div>
          <div className="text-xs text-ink-muted min-w-0 break-words">{h.usual.map((u) => `${usualLabel(u)} ×${u.qty}`).join("; ")}</div>
        </li>
      );
    });

  const sendRows = rows.slice(0, 200).map((r) => (
    <li key={`${r.broadcastId}-${r.phone}`} className="px-4 py-3 grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_120px_150px_110px_130px] lg:items-start text-sm">
      <div className="min-w-0">
        <div className="font-medium break-words">{r.name || `…${r.phone.slice(-4)}`}</div>
        <div className="text-xs text-ink-muted">
          {r.manager} · {HABIT_MODE_LABELS[r.mode]} ·{" "}
          <Link href={`/clients/broadcasts/${r.broadcastId}`} className="hover:underline">
            {formatDay(r.day)}
          </Link>
        </div>
        <details className="text-xs text-ink-secondary mt-1">
          <summary className="cursor-pointer text-ink-muted">текст</summary>
          <div className="whitespace-pre-wrap mt-1">{r.text}</div>
        </details>
      </div>
      <div>
        <Pill tone={r.state === "replied" ? "good" : r.state === "error" ? "bad" : r.state === "queued" ? "wait" : "muted"}>{RECIPIENT_STATE_LABELS[r.state]}</Pill>
      </div>
      <div className="text-xs text-ink-secondary break-words">
        {r.replyText ? (
          <>
            <span className="text-ink-muted">{formatMoment(r.replyAt)}: </span>
            {r.replyText.slice(0, 120)}
          </>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </div>
      <div className="tabular-nums text-ink-secondary">{r.sentAt ? formatMoment(r.sentAt) : "—"}</div>
      <div className="tabular-nums">
        {r.orderId ? (
          <Link href={`/orders/${r.orderId}`} className="text-status-good font-semibold hover:underline">
            {money(r.orderAmount)}
          </Link>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </div>
    </li>
  ));

  const statRow = (s: { key: string; manager: string; recipients: number; sent: number; read: number; replied: number; ordered: number; revenue: number; queued: number }) => (
    <li key={s.key} className="px-4 py-2.5 grid grid-cols-[minmax(0,1fr)_repeat(5,72px)] gap-2 text-sm items-center">
      <div className="font-medium truncate">{s.manager}</div>
      <div className="tabular-nums text-right">
        {s.sent}
        {s.queued > 0 && <span className="text-xs text-ink-muted"> +{s.queued}</span>}
      </div>
      <div className="tabular-nums text-right text-ink-secondary">{pct(s.read, s.sent)}</div>
      <div className="tabular-nums text-right">{s.replied}</div>
      <div className="tabular-nums text-right">{s.ordered}</div>
      <div className="tabular-nums text-right text-ink-secondary">{s.revenue ? money(s.revenue) : "—"}</div>
    </li>
  );
  const statHead = (
    <li className="px-4 py-2 grid grid-cols-[minmax(0,1fr)_repeat(5,72px)] gap-2 text-xs text-ink-muted border-b border-line-hairline">
      <div />
      <div className="text-right">отправлено</div>
      <div className="text-right">прочитали</div>
      <div className="text-right">ответили</div>
      <div className="text-right">заказали</div>
      <div className="text-right">на сумму</div>
    </li>
  );

  return (
    <div>
      <PageHeader area="leads" title="Постоянники" subtitle="Кто заказывает регулярно и как идут напоминания от имени менеджеров" tabs={clientsTabsFor(undefined, role)} />

      {manage && managers.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap -mx-1 px-1 mb-5">
          {["", ...managers].map((m) => (
            <Link
              key={m || "all"}
              href={m ? `/clients/habits?manager=${encodeURIComponent(m)}` : "/clients/habits"}
              className={
                "flex-none h-8 px-3 rounded-full border text-[13px] whitespace-nowrap inline-flex items-center transition-colors " +
                (m.toLowerCase() === picked ? "bg-ink-primary border-ink-primary text-white" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary")
              }
            >
              {m ? nameOf(m) : "Все менеджеры"}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="client" label="Постоянников" value={habits.length} hint={`из ${habitsAll.filter((h) => !picked || h.managerEmail.toLowerCase() === picked).length} клиентов за 90 дней`} />
        <KpiTile icon="chart" label="Ожидаемо в неделю" value={money(weekly)} hint="средний чек × заявок в неделю" />
        <KpiTile icon="clock" label="Молчат дольше обычного" value={overdue} hint={overdue ? "кандидаты на звонок" : "все в графике"} tone={overdue ? "warn" : undefined} />
        <KpiTile icon="message" label={`Напоминаний за ${DAYS} дн.`} value={total?.sent ?? 0} hint={total?.queued ? `в очереди ${total.queued}` : total?.sent ? `прочитали ${pct(total.read, total.sent)}` : "ещё не было"} />
        <KpiTile icon="check" label="Заказали после" value={total?.ordered ?? 0} hint={total?.revenue ? money(total.revenue) : total?.sent ? `ответили ${total.replied}` : undefined} tone={total?.ordered ? "good" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2 items-start mb-5">
        <Section tone="leads" icon="message" title={`Рассылки постоянникам за ${DAYS} дней`} aside={<span className="text-xs text-ink-muted">по менеджерам</span>} flush>
          <ol>
            {statHead}
            {byManager.length ? byManager.map(statRow) : <li className="px-4 py-4 text-sm text-ink-muted">Ещё не отправляли.</li>}
          </ol>
        </Section>
        <Section tone="analytics" icon="chart" title="По режиму" aside={<span className="text-xs text-ink-muted">в его день · по просьбе · сам</span>} flush>
          <ol>
            {statHead}
            {stats.byMode.map(statRow)}
          </ol>
          <div className="px-4 py-3 text-xs text-ink-muted border-t border-line-hairline">
            В день клиента — утром с 9:00; по просьбе — менеджер пишет боту Экокультуры «напомни постоянникам …» и отвечает «ДА»; сам — когда постоянник молчит дольше
            своего обычного промежутка (до 8 в день с номера, 10–18). Тексты — словами менеджера, цифры проверяет программа.
            {lastRun && <div className="mt-1">Последний запуск: {lastRun}</div>}
            {Array.from(styles.entries()).length > 0 && (
              <div className="mt-1">Почерк менеджеров: {Array.from(styles.entries()).map(([code, p]) => `${code.replace(/^m-/, "")} — ${p.messages} сообщ., обновлён ${formatDay(p.updatedAt.slice(0, 10))}`).join("; ")}.</div>
            )}
          </div>
        </Section>
      </div>

      <Section tone="leads" icon="client" title="Постоянники" aside={<span className="text-xs text-ink-muted">самые ценные первыми</span>} flush className="mb-5">
        <PagedList items={habitRows} size={30} className="divide-y divide-line-hairline" empty={<div className="px-4 py-6 text-sm text-ink-muted">Постоянников пока нет.</div>} />
      </Section>

      <Section tone="analytics" icon="message" title="Кому писали" aside={<span className="text-xs text-ink-muted">свежие первыми</span>} flush>
        <PagedList items={sendRows} size={30} className="divide-y divide-line-hairline" empty={<div className="px-4 py-6 text-sm text-ink-muted">Напоминаний ещё не было.</div>} />
      </Section>
    </div>
  );
}
