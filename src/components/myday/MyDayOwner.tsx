import Link from "next/link";
import clsx from "clsx";
import type { DayUser } from "@/lib/myDay/greeting";
import { buildOwnerDay, type ManagerTone } from "@/lib/myDay/owner";
import DayCard, { DayEmpty, DayRow } from "./DayCard";
import KpiTile from "../KpiTile";
import Pill from "../Pill";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { listPayments } from "@/lib/repo/payments";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { listClaims } from "@/lib/repo/claims";
import { listWaMessages } from "@/lib/repo/talks";
import { listAssistantLog, listWaLines } from "@/lib/repo/waLines";
import { listRecipients, settingsMap } from "@/lib/repo/broadcasts";
import { listLeads } from "@/lib/repo/leads";
import { getCurrentPrices } from "@/lib/repo/prices";
import { getSalesSnapshot } from "@/lib/salesAnalytics";
import { getFinanceSnapshot } from "@/lib/finance";
import { getStockSnapshot } from "@/lib/stock";
import StockAgeCard from "./StockAgeCard";
import { homeFocus } from "@/lib/homeFocus";
import { paceOf } from "@/lib/planOverview";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { inStore } from "@/lib/officeStore";
import { isManagerLine } from "@/lib/waLines";
import { localDayKey } from "@/lib/timezone";
import { CLAIM_STATUSES, ROLES } from "@/lib/constants";
import { isNotASale } from "@/lib/orderKind";
import { priceFor } from "@/lib/priceList";
import { stockMap as liveStockMap } from "@/lib/botKnowledge";
import { parsePush, pushLineText, pushLines, pushSold, SALES_PUSH_SETTING } from "@/lib/salesPush";
import { shortMoney } from "@/lib/formatNumber";

/**
 * «Мой день» владельца и РОПа (19.10.2026, макет принят владельцем): строка «вчера», четыре плитки, слева «Требует
 * внимания» и менеджеры против темпа, справа ИИ за сутки, склад по компаниям и что сегодня уедет. Счёт — `buildOwnerDay`.
 * РОП видит то же: оплаты и продажи ему открыты на просмотр. Всё читается одним `prefetchTables` (грабли 1.17).
 */
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${num(n)} ₸`;
const TONE_BAR: Record<ManagerTone, string> = { good: "bg-accent", warn: "bg-status-warning", bad: "bg-status-critical", none: "bg-line-strong" };
const TONE_TEXT: Record<ManagerTone, string> = { good: "text-status-good", warn: "text-[#8a5a00]", bad: "text-status-critical", none: "text-ink-muted" };

export default async function MyDayOwner({ user }: { user: DayUser }) {
  const now = new Date();
  const today = localDayKey(now);
  const month = today.slice(0, 7);
  const admin = user.role === ROLES.ADMIN;

  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.PLANS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.PRICE_HISTORY,
    SHEET_TABS.CLAIMS,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.WA_LINES,
    SHEET_TABS.ASSISTANT_LOG,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.LEADS,
  ]);
  const [orders, users, plans, payments, batches, settings, claims, messages, lines, assistantLog, recipients, leads, settingsAll, prices] =
    await Promise.all([
      listOrdersWithItems(),
      listUsers(),
      getPlansForPeriod(month),
      listPayments(),
      listBatches(),
      getSettings(),
      listClaims().catch(() => []),
      listWaMessages({ lines: "all" }).catch(() => []),
      listWaLines().catch(() => []),
      listAssistantLog().catch(() => []),
      listRecipients().catch(() => []),
      listLeads().catch(() => []),
      settingsMap().catch(() => ({}) as Record<string, string>),
      getCurrentPrices(today).catch(() => new Map()),
    ]);

  const [sales, finance, stock] = await Promise.all([
    getSalesSnapshot(month, now, { orders, users, plans }),
    getFinanceSnapshot("month", undefined, now, { orders, users, payments }),
    getStockSnapshot(now, { batches, settings }),
  ]);

  const inStockAll = batches.filter((b) => b.quantityRemaining > 0);
  const expiredStems = inStockAll
    .map((b) => computeBatchStorageInfo(b, settings, now))
    .filter((i) => i.status === "critical")
    .reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const focus = homeFocus({
    role: user.role,
    email: user.email,
    orders,
    todayKey: today,
    extras: {
      expiredStems,
      stockStems: inStockAll.reduce((s, b) => s + b.quantityRemaining, 0),
      openClaims: claims.filter((c) => c.status === CLAIM_STATUSES.NEW).length,
    },
  });

  // «Распродаём в первую очередь» — то же, что на старой главной (`salesPush.ts`).
  const pushItems = parsePush(settingsAll[SALES_PUSH_SETTING]);
  let push: { text: string; sold7: number }[] = [];
  if (pushItems.length) {
    const live = Array.from(liveStockMap(inStore(batches, ""), settings, now).values());
    const weekAgo = localDayKey(new Date(now.getTime() - 6 * 86_400_000));
    push = pushLines(pushItems, live, (f, v, g) => priceFor(prices, f, v, g))
      .filter((l) => l.qty > 0)
      .map((l) => ({
        text: pushLineText(l),
        sold7: pushSold(l, orders, weekAgo, today, (iso) => localDayKey(new Date(iso)), (o) => !isNotASale(o)),
      }));
  }

  const overdueOrders = finance.calls.filter((c) => c.overdue && c.debt > 0).length;
  const day = buildOwnerDay({
    today,
    month,
    pacePercent: paceOf(month, today).pacePercent,
    orders,
    managers: sales.managers,
    totals: { amountMonth: sales.totals.amountMonth, targetAmount: sales.totals.targetAmount },
    payments,
    debts: { total: finance.debtTotal, overdue: finance.debtOverdueTotal, overdueOrders, openOrders: finance.calls.filter((c) => c.debt > 0).length },
    stock: { overall: stock.overall, companies: stock.companies },
    push,
    attention: focus?.attention ?? [],
    managerLines: lines.filter((l) => isManagerLine(l.code)).map((l) => ({ code: l.code, managerEmail: l.managerEmail })),
    messages,
    assistantLog,
    recipients,
    leads,
    nameByEmail: new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])),
    nowMs: now.getTime(),
    toDay: (iso) => localDayKey(new Date(iso)),
  });

  const stockHref = admin ? "/warehouse/analytics" : "/office";
  const shipHref = admin ? "/warehouse" : "/office/ship";
  const pct = day.sales.percent;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-secondary">
        <span>
          Вчера продали на <strong className="text-ink-primary">{money(day.summary.yesterdayAmount)}</strong>
          {day.summary.yesterdayOrders > 0 && <span> · {num(day.summary.yesterdayOrders)} заявок</span>}
        </span>
        <span>
          пришло <strong className="text-ink-primary">{money(day.summary.yesterdayReceived)}</strong>
        </span>
        <span className={day.summary.attentionCount ? "text-status-critical font-semibold" : ""}>
          {day.summary.attentionCount ? `${num(day.summary.attentionCount)} требуют внимания` : "ничего не требует внимания"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card !p-4 sm:!p-5">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Продажи {sales.periodLabel.toLowerCase()}</span>
            {day.sales.target > 0 && <span>план {shortMoney(day.sales.target)}</span>}
          </div>
          <div className="font-display font-extrabold text-[22px] sm:text-[26px] tabular-nums mt-1.5 leading-none">{shortMoney(day.sales.amount)}</div>
          {pct !== null ? (
            <>
              <div className="relative h-2 rounded-full bg-surface-sunk overflow-hidden mt-3">
                <div className={clsx("h-full rounded-full", TONE_BAR[day.sales.tone])} style={{ width: `${Math.min(100, pct)}%` }} />
                <div className="absolute top-[-2px] w-0.5 h-3 bg-ink-primary" style={{ left: `${Math.min(100, day.sales.pacePercent)}%` }} aria-hidden />
              </div>
              <div className={clsx("text-xs mt-2 font-semibold", TONE_TEXT[day.sales.tone])}>
                {Math.round(pct)} % · {pct >= day.sales.pacePercent ? "выше темпа" : "ниже темпа"} ({Math.round(day.sales.pacePercent)} %)
              </div>
            </>
          ) : (
            <div className="text-xs text-ink-secondary mt-2">
              План на месяц не поставлен — <Link href="/plans/sales" className="text-accent font-semibold">поставить</Link>
            </div>
          )}
        </div>
        <KpiTile
          icon="wallet"
          label="Деньги за неделю"
          value={shortMoney(day.money.week)}
          hint={day.money.byFarm.length ? day.money.byFarm.map((f) => `${f.label} ${shortMoney(f.amount)}`).join(" · ") : "за семь дней не приходили"}
          href="/finance"
        />
        <KpiTile
          icon="alert"
          label="Долги"
          value={shortMoney(day.debts.total)}
          hint={day.debts.overdue > 0 ? `просрочено ${shortMoney(day.debts.overdue)} · ${num(day.debts.overdueOrders)} заявок` : `${num(day.debts.openOrders)} заявок, срок ещё не вышел`}
          tone={day.debts.overdue > 0 ? "bad" : undefined}
          href="/finance/debts"
        />
        <KpiTile
          icon="box"
          label="Склад"
          value={`${num(day.stock.stems)} шт.`}
          hint={
            day.stock.criticalStems > 0
              ? `${day.stock.criticalShare} % дольше срока${day.stock.push ? ` · распродаём: ${day.stock.push}` : ""}`
              : day.stock.push
                ? `распродаём: ${day.stock.push}`
                : "всё в сроке"
          }
          tone={day.stock.criticalShare >= 10 ? "bad" : day.stock.criticalStems > 0 ? "warn" : undefined}
          href={stockHref}
        />
      </div>

      {/* «Сколько дней лежит» — сразу под плитками (21.10.2026, владелец: «двинь эти данные наверх»). */}
      <StockAgeCard buckets={stock.ageBuckets} total={stock.totalStems} href={stockHref} shelfNote={shelfNoteOf(settings)} />

      <div className="grid gap-5 xl:grid-cols-5 items-start">
        <div className="xl:col-span-3 space-y-5 min-w-0">
          <DayCard tone="bad" icon="alert" title="Требует внимания" count={day.attention.length} countTone={day.attention.length ? "bad" : "muted"} hint="по важности · каждая строка ведёт в готовый список">
            {day.attention.length === 0 ? (
              <DayEmpty>Ничего не стоит и не ждёт решения. Хороший день.</DayEmpty>
            ) : (
              day.attention.slice(0, 6).map((a, i) => (
                <Link key={a.href + a.label} href={a.href} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-line-hairline first:border-t-0 hover:bg-surface-plane transition-colors">
                  <Pill tone={a.tone === "critical" ? "bad" : "wait"} dot={false}>
                    {i + 1}
                  </Pill>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{a.label}</span>
                    <span className="block text-xs text-ink-secondary">{a.detail}</span>
                  </span>
                  <span className="text-ink-muted" aria-hidden>
                    →
                  </span>
                </Link>
              ))
            )}
          </DayCard>

          <DayCard tone="sales" icon="trophy" title={`Менеджеры ${sales.periodLabel.toLowerCase()}`} link={{ href: "/sales", label: "Рейтинг и бонусы →" }}>
            {day.managers.length === 0 ? (
              <DayEmpty>В этом месяце заявок ещё не оформляли.</DayEmpty>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-ink-muted bg-surface-plane">
                      <th className="px-4 sm:px-5 py-2 font-bold">Менеджер</th>
                      <th className="px-3 py-2 font-bold">Продано</th>
                      <th className="px-3 py-2 font-bold w-[32%]">План</th>
                      <th className="px-3 py-2 font-bold text-right">Заявок</th>
                      <th className="px-4 sm:px-5 py-2 font-bold text-right whitespace-nowrap">Ждут ответа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.managers.slice(0, 6).map((m) => (
                      <tr key={m.email} className="border-t border-line-hairline">
                        <td className="px-4 sm:px-5 py-2.5 font-semibold">{m.name}</td>
                        <td className="px-3 py-2.5 font-display font-bold tabular-nums whitespace-nowrap">{shortMoney(m.amount)}</td>
                        <td className="px-3 py-2.5">
                          {m.percent === null ? (
                            <span className="text-xs text-ink-muted">без плана</span>
                          ) : (
                            <>
                              <div className="h-2 rounded-full bg-surface-sunk overflow-hidden">
                                <div className={clsx("h-full rounded-full", TONE_BAR[m.tone])} style={{ width: `${Math.min(100, m.percent)}%` }} />
                              </div>
                              <div className={clsx("text-[11px] mt-1", TONE_TEXT[m.tone])}>
                                {Math.round(m.percent)} % из {shortMoney(m.target)}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{num(m.orders)}</td>
                        <td className="px-4 sm:px-5 py-2.5 text-right">
                          {m.waiting > 0 ? (
                            <Link href="/clients/chats">
                              <Pill tone="bad" dot={false}>
                                {num(m.waiting)}
                              </Pill>
                            </Link>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DayCard>
        </div>

        <div className="xl:col-span-2 space-y-5 min-w-0">
          <DayCard tone="order" icon="message" title="ИИ за сутки" link={{ href: "/clients/chats", label: "Переписки →" }}>
            <DayRow right={<span className="text-sm text-right">{num(day.ai.broadcastSent)} ушло · {num(day.ai.broadcastReplied)} ответили · {num(day.ai.broadcastOrders)} заявок</span>}>
              <Link href="/clients/broadcasts" className="text-sm font-semibold">
                Рассылки
              </Link>
            </DayRow>
            <DayRow right={<span className="text-sm text-right">{num(day.ai.assistantReplies)} ответов · {num(day.ai.assistantOrders)} заказов{day.ai.assistantNotes ? ` · ${num(day.ai.assistantNotes)} записок` : ""}</span>}>
              <span className="text-sm font-semibold">Помощник менеджеров</span>
            </DayRow>
            <DayRow right={<span className="text-sm text-right">{num(day.ai.botChats)} разговоров · {num(day.ai.botOrders)} заказов</span>}>
              <Link href="/clients/broadcasts/bot" className="text-sm font-semibold">
                Бот основного номера
              </Link>
            </DayRow>
            <DayRow right={<span className="text-sm text-right">{num(day.ai.adsLeads)} новых лидов</span>}>
              <Link href="/clients/leads/ads" className="text-sm font-semibold">
                Номер Земфиры
              </Link>
            </DayRow>
          </DayCard>

          <DayCard tone="stock" icon="box" title="Склад по компаниям" link={{ href: stockHref, label: "Склад →" }}>
            {day.companies.length === 0 ? (
              <DayEmpty>На складе пусто.</DayEmpty>
            ) : (
              day.companies.map((c) => (
                <div key={c.farm} className="px-4 sm:px-5 py-3 border-t border-line-hairline first:border-t-0">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold">{c.label}</span>
                    <span className="tabular-nums">
                      <strong>{num(c.stems)} шт.</strong>
                      <span className={clsx("text-xs ml-1.5", c.badShare >= 10 ? "text-status-critical font-semibold" : "text-ink-muted")}>· {c.badShare} % дольше срока</span>
                    </span>
                  </div>
                  <div className="flex h-2 rounded-full bg-surface-sunk overflow-hidden mt-2" role="img" aria-label={`В сроке ${c.okShare} %, скоро ${c.warnShare} %, дольше срока ${c.badShare} %`}>
                    <div className="bg-status-good h-full" style={{ width: `${c.okShare}%` }} />
                    <div className="bg-status-warning h-full" style={{ width: `${c.warnShare}%` }} />
                    <div className="bg-status-critical h-full" style={{ width: `${c.badShare}%` }} />
                  </div>
                </div>
              ))
            )}
            {day.stock.push && (
              <div className="px-4 sm:px-5 py-3 border-t border-line-hairline text-sm">
                <span className="text-ink-secondary">Распродаём: </span>
                {day.stock.push}
                {push[0]?.sold7 ? <span className="text-ink-muted"> · за 7 дней ушло {num(push[0].sold7)}</span> : null}
              </div>
            )}
          </DayCard>

          <DayCard tone="order" icon="truck" title="Сегодня к отгрузке" link={{ href: shipHref, label: "Очередь →" }}>
            {day.shipToday.length === 0 ? (
              <DayEmpty>На сегодня готовых к отгрузке заявок нет.</DayEmpty>
            ) : (
              day.shipToday.map((s) => (
                <DayRow key={s.label} right={<span className="text-sm tabular-nums"><strong>{num(s.orders)}</strong> {s.orders === 1 ? "заявка" : "заявок"} · {num(s.stems)} шт.</span>}>
                  <span className="text-sm font-semibold">{s.label}</span>
                </DayRow>
              ))
            )}
          </DayCard>
        </div>

      </div>
    </div>
  );
}

/** «роза 7 · хризантема 18 · эустома 10 дн.» — сроки хранения из настроек, для подсказки «Сколько дней лежит». */
function shelfNoteOf(settings: { shelfLifeDays: Record<string, number> }, types: string[] = ["rose", "chrysanthemum", "eustoma"]): string {
  const name: Record<string, string> = { rose: "роза", chrysanthemum: "хризантема", eustoma: "эустома" };
  return types.filter((t) => settings.shelfLifeDays[t]).map((t) => `${name[t] ?? t} ${settings.shelfLifeDays[t]}`).join(" · ") + " дн.";
}
