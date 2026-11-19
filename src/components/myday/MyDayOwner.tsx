import Link from "next/link";
import clsx from "clsx";
import type { DayUser } from "@/lib/myDay/greeting";
import { buildOwnerDay, type ManagerTone } from "@/lib/myDay/owner";
import DayCard, { DayEmpty } from "./DayCard";
import KpiTile from "../KpiTile";
import StockAgeCard from "./StockAgeCard";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { listPayments } from "@/lib/repo/payments";
import { listBatches } from "@/lib/repo/batches";
import { listShipments } from "@/lib/repo/shipments";
import { listWriteoffs } from "@/lib/repo/writeoffs";
import { getSettings } from "@/lib/repo/settings";
import { getSalesSnapshot } from "@/lib/salesAnalytics";
import { getFinanceSnapshot } from "@/lib/finance";
import { getStockSnapshot } from "@/lib/stock";
import { paceOf } from "@/lib/planOverview";
import { REGION_STORES, inStore, isRegionStore } from "@/lib/officeStore";
import { localDayKey } from "@/lib/timezone";
import { ROLES } from "@/lib/constants";
import { moneyExact, shortMoney } from "@/lib/formatNumber";

/**
 * Главная владельца и РОПа — «состояние на сейчас» (18.11.2026, владелец: «данные по стоку (сколько дней) — это очень
 * важно, но нужно убрать всё остальное; нужно текущие продажи за день, сколько продали, сколько должны и ещё данные,
 * которые отражают состояние»). Четыре плитки дня (продано, получено, долг, месяц к плану), «Сколько дней лежит»,
 * склад за день и две таблицы — продажи сегодня по менеджерам и кто должен. Счёт — `buildOwnerDay`. Убранное живёт на
 * своих страницах: «Переписки», «Рассылки», «Цифры за период», «Оплаты → Долги». Читается одним `prefetchTables`
 * (грабли 1.17) — и вдвое меньше вкладок, чем раньше: переписка, журнал помощника и рассылки главной больше не нужны.
 */
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");
const TONE_BAR: Record<ManagerTone, string> = { good: "bg-accent", warn: "bg-status-warning", bad: "bg-status-critical", none: "bg-line-strong" };
const TONE_TEXT: Record<ManagerTone, string> = { good: "text-status-good", warn: "text-[#8a5a00]", bad: "text-status-critical", none: "text-ink-muted" };
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export default async function MyDayOwner({ user }: { user: DayUser }) {
  const now = new Date();
  const today = localDayKey(now);
  const month = today.slice(0, 7);
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1] ?? "месяц";
  const admin = user.role === ROLES.ADMIN;

  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.PLANS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.SETTINGS,
  ]);
  const [orders, users, plans, payments, batches, shipments, writeoffs, settings] = await Promise.all([
    listOrdersWithItems(),
    listUsers(),
    getPlansForPeriod(month),
    listPayments(),
    listBatches(),
    listShipments().catch(() => []),
    listWriteoffs().catch(() => []),
    getSettings(),
  ]);

  // «Сколько дней лежит» — то, чем торгуем отсюда: основной склад и офис. Склады городов — отдельной строкой: их остаток
  // ведут директора регионов, и лежащий там цветок не должен красить наш склад «дольше срока».
  const ours = batches.filter((b) => !isRegionStore(b.store));
  const [sales, finance, stock] = await Promise.all([
    getSalesSnapshot(month, now, { orders, users, plans }),
    getFinanceSnapshot("month", undefined, now, { orders, users, payments }),
    getStockSnapshot(now, { batches: ours, settings }),
  ]);
  const regions = REGION_STORES.map((r) => ({ code: r.code, label: r.label, stems: inStore(batches, r.code).reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0) })).filter((r) => r.stems > 0);

  const day = buildOwnerDay({
    today,
    pacePercent: paceOf(month, today).pacePercent,
    orders,
    managers: sales.managers,
    totals: { amountMonth: sales.totals.amountMonth, targetAmount: sales.totals.targetAmount },
    payments,
    debts: { total: finance.debtTotal, overdue: finance.debtOverdueTotal },
    calls: finance.calls,
    shipments,
    writeoffs,
    batches,
    nameByEmail: new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])),
    toDay: (iso) => localDayKey(new Date(iso)),
  });

  // «Аналитика склада» с 12.11.2026 в архиве отчётов: со склада на главной — сразу в партии, где видно, что и сколько лежит.
  const stockHref = admin ? "/warehouse/batches" : "/office";
  const shipHref = admin ? "/warehouse" : "/office/ship";
  const pct = day.month.percent;
  const sellers = day.managers.filter((m) => m.todayAmount > 0 || m.monthAmount > 0).slice(0, 8);
  const overdueShare = day.debts.total > 0 ? Math.round((day.debts.overdue / day.debts.total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Четыре цифры дня. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon="order"
          label="Продано сегодня"
          value={moneyExact(day.sold.amount)}
          hint={
            <>
              <span className="block text-ink-secondary">
                {day.sold.orders > 0 ? `${num(day.sold.orders)} ${plural(day.sold.orders, "заявка", "заявки", "заявок")} · ${num(day.sold.stems)} шт.` : "заявок сегодня ещё не оформляли"}
              </span>
              <span className="block mt-0.5">
                вчера {shortMoney(day.sold.yesterdayAmount)}
                {day.sold.avgDay > 0 && ` · обычный день ${shortMoney(day.sold.avgDay)}`}
              </span>
            </>
          }
          href="/orders"
        />
        <KpiTile
          icon="wallet"
          label="Получено сегодня"
          value={moneyExact(day.received.today)}
          hint={
            <>
              <span className="block text-ink-secondary">{day.received.byFarm.length ? day.received.byFarm.map((f) => `${f.label} ${shortMoney(f.amount)}`).join(" · ") : "сегодня деньги ещё не приходили"}</span>
              <span className="block mt-0.5">
                вчера {shortMoney(day.received.yesterday)} · за {monthName} {shortMoney(day.received.month)}
              </span>
            </>
          }
          href="/finance"
        />
        <KpiTile
          icon="alert"
          label="Нам должны"
          value={shortMoney(day.debts.total)}
          hint={
            day.debts.total <= 0 ? (
              "долгов нет"
            ) : (
              <>
                <span className={clsx("block", day.debts.overdue > 0 ? "text-status-critical font-medium" : "text-ink-secondary")}>
                  {day.debts.overdue > 0 ? `просрочено ${shortMoney(day.debts.overdue)} · ${overdueShare} %` : "просрочки нет"}
                </span>
                <span className="block mt-0.5">
                  {num(day.debts.clients)} {plural(day.debts.clients, "клиент", "клиента", "клиентов")} · {num(day.debts.openOrders)} {plural(day.debts.openOrders, "заявка", "заявки", "заявок")}
                </span>
              </>
            )
          }
          href="/finance/debts"
        />
        <div className="card !p-4">
          <div className="flex items-center justify-between gap-2 text-[12.5px] leading-4 text-ink-secondary">
            <Link href="/analytics/flow?preset=month&view=sales" className="hover:text-accent whitespace-nowrap" title="Цифры за период: продажи и клиенты">
              Продано за {monthName} →
            </Link>
            {day.month.target > 0 && <span className="text-ink-muted whitespace-nowrap">план {shortMoney(day.month.target)}</span>}
          </div>
          <div className="font-display font-semibold text-[22px] sm:text-[24px] tabular-nums mt-2 leading-none">{shortMoney(day.month.amount)}</div>
          {pct !== null ? (
            <>
              <div className="relative h-2 rounded-full bg-surface-sunk overflow-hidden mt-3">
                <div className={clsx("h-full rounded-full", TONE_BAR[day.month.tone])} style={{ width: `${Math.min(100, pct)}%` }} />
                <div className="absolute top-[-2px] w-0.5 h-3 bg-ink-primary" style={{ left: `${Math.min(100, day.month.pacePercent)}%` }} aria-hidden />
              </div>
              <div className={clsx("text-xs mt-2 font-medium", TONE_TEXT[day.month.tone])}>
                {Math.round(pct)} % плана · {pct >= day.month.pacePercent ? "выше темпа" : "ниже темпа"} ({Math.round(day.month.pacePercent)} %)
              </div>
            </>
          ) : (
            <div className="text-xs text-ink-secondary mt-2">
              План на месяц не поставлен —{" "}
              <Link href="/plans/sales" className="text-accent font-semibold">
                поставить
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* «Сколько дней лежит» — главное про склад. */}
      <div>
        <StockAgeCard buckets={stock.ageBuckets} total={stock.totalStems} href={stockHref} shelfNote={shelfNoteOf(settings)} />
        {regions.length > 0 && (
          <div className="mt-2 px-1 text-xs text-ink-muted flex flex-wrap gap-x-4 gap-y-1">
            <span>В карточке — основной склад и офис. На складах городов:</span>
            {regions.map((r) => (
              <Link key={r.code} href={`/region/${r.code}`} className="hover:text-accent tabular-nums">
                {r.label} <strong className="text-ink-secondary font-medium">{num(r.stems)} шт.</strong>
              </Link>
            ))}
            <Link href="/region" className="text-accent font-medium hover:underline">
              Регионы →
            </Link>
          </div>
        )}
      </div>

      {/* Склад за день: что пришло, что ушло, что ещё должно уйти сегодня. */}
      <DayCard tone="stock" icon="truck" title="Склад за сегодня" link={{ href: shipHref, label: "Очередь на отгрузку →" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <DayStat label="Принято на склад" value={`${num(day.warehouse.received)} шт.`} note={day.warehouse.received > 0 ? "срезка, принятая сегодня" : "приёмки сегодня не было"} />
          <DayStat
            label="Отгружено"
            value={`${num(day.warehouse.shipped)} шт.`}
            note={day.warehouse.shippedOrders > 0 ? `${num(day.warehouse.shippedOrders)} ${plural(day.warehouse.shippedOrders, "заявка", "заявки", "заявок")}` : "отгрузок сегодня не было"}
            className="border-l border-line-hairline"
          />
          <DayStat
            label="Осталось отгрузить сегодня"
            value={`${num(day.warehouse.toShipStems)} шт.`}
            note={
              day.warehouse.toShipOrders > 0
                ? `${num(day.warehouse.toShipOrders)} ${plural(day.warehouse.toShipOrders, "заявка", "заявки", "заявок")} · ${day.warehouse.toShip.map((s) => `${s.label} ${num(s.stems)}`).join(" · ")}`
                : "всё, что готово на сегодня, отгружено"
            }
            tone={day.warehouse.toShipOrders > 0 ? "warn" : "good"}
            className="border-t lg:border-t-0 lg:border-l border-line-hairline"
          />
          <DayStat
            label="Списано"
            value={`${num(day.warehouse.writtenOff)} шт.`}
            note={day.warehouse.writtenOff > 0 ? "списания и пересчёты за день" : "списаний сегодня не было"}
            tone={day.warehouse.writtenOff > 0 ? "bad" : undefined}
            className="border-t border-l lg:border-t-0 border-line-hairline"
          />
        </div>
      </DayCard>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2 items-start">
        <DayCard tone="sales" icon="trophy" title="Продажи сегодня" hint="кто сколько оформил · рядом месяц и план" link={{ href: "/sales", label: "Рейтинг →" }}>
          {sellers.length === 0 ? (
            <DayEmpty>В этом месяце заявок ещё не оформляли.</DayEmpty>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60">
                    <th className="px-4 sm:px-5 py-2 font-medium">Менеджер</th>
                    <th className="px-3 py-2 font-medium text-right">Сегодня</th>
                    <th className="px-3 py-2 font-medium text-right">Заявок</th>
                    <th className="hidden sm:table-cell px-4 sm:px-5 py-2 font-medium w-[34%]">За месяц</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((m) => (
                    <tr key={m.email} className="border-t border-line-hairline">
                      <td className="px-4 sm:px-5 py-2.5">
                        <span className="font-medium">{m.name}</span>
                        <span className={clsx("block sm:hidden text-xs mt-0.5", TONE_TEXT[m.tone])}>
                          за месяц {shortMoney(m.monthAmount)}
                          {m.percent !== null && ` · ${Math.round(m.percent)} % плана`}
                        </span>
                      </td>
                      <td className={clsx("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", m.todayAmount > 0 ? "font-semibold" : "text-ink-muted")}>{m.todayAmount > 0 ? moneyExact(m.todayAmount) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.todayOrders > 0 ? num(m.todayOrders) : "—"}</td>
                      <td className="hidden sm:table-cell px-4 sm:px-5 py-2.5">
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="tabular-nums text-ink-secondary whitespace-nowrap">{shortMoney(m.monthAmount)}</span>
                          <span className={clsx("whitespace-nowrap", TONE_TEXT[m.tone])}>{m.percent === null ? "без плана" : `${Math.round(m.percent)} % плана`}</span>
                        </div>
                        {m.percent !== null && (
                          <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden mt-1">
                            <div className={clsx("h-full rounded-full", TONE_BAR[m.tone])} style={{ width: `${Math.min(100, m.percent)}%` }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {day.sold.byFlower.length > 0 && (
            <div className="px-4 sm:px-5 py-3 border-t border-line-hairline text-sm flex flex-wrap gap-x-5 gap-y-1">
              <span className="text-ink-secondary">Сегодня по цветам:</span>
              {day.sold.byFlower.map((f) => (
                <span key={f.flowerType} className="tabular-nums whitespace-nowrap">
                  {f.label} <strong className="font-semibold">{num(f.stems)} шт.</strong> <span className="text-ink-muted">· {shortMoney(f.amount)}</span>
                </span>
              ))}
            </div>
          )}
        </DayCard>

        <DayCard
          tone={day.debts.overdue > 0 ? "bad" : "money"}
          icon="alert"
          title="Кто должен"
          count={day.debts.clients}
          countTone={day.debts.overdue > 0 ? "bad" : "muted"}
          hint="сначала те, у кого просрочено"
          link={{ href: "/finance/debts", label: "Все долги →" }}
        >
          {day.debts.top.length === 0 ? (
            <DayEmpty>Никто не должен.</DayEmpty>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60">
                    <th className="px-4 sm:px-5 py-2 font-medium">Клиент</th>
                    <th className="px-3 py-2 font-medium text-right">Долг</th>
                    <th className="px-3 py-2 font-medium text-right">Просрочено</th>
                    <th className="hidden sm:table-cell px-4 sm:px-5 py-2 font-medium text-right">Дней</th>
                  </tr>
                </thead>
                <tbody>
                  {day.debts.top.map((d) => (
                    <tr key={d.clientName} className="border-t border-line-hairline">
                      <td className="px-4 sm:px-5 py-2.5">
                        <span className="font-medium">{d.clientName}</span>
                        {d.orders > 1 && (
                          <span className="text-xs text-ink-muted ml-2 whitespace-nowrap">
                            {num(d.orders)} {plural(d.orders, "заявка", "заявки", "заявок")}
                          </span>
                        )}
                        <span className="block sm:hidden text-xs text-ink-muted mt-0.5">долгу {num(d.days)} дн.</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">{moneyExact(d.debt)}</td>
                      <td className={clsx("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", d.overdue > 0 ? "text-status-critical font-medium" : "text-ink-muted")}>{d.overdue > 0 ? moneyExact(d.overdue) : "—"}</td>
                      <td className="hidden sm:table-cell px-4 sm:px-5 py-2.5 text-right tabular-nums text-ink-secondary">{num(d.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {day.debts.clients > day.debts.top.length && (
            <div className="px-4 sm:px-5 py-3 border-t border-line-hairline text-xs text-ink-muted">
              Показаны {day.debts.top.length} из {num(day.debts.clients)} — остальные в «Оплаты → Долги».
            </div>
          )}
        </DayCard>
      </div>

      <div className="text-sm">
        <Link href="/analytics/flow" className="text-accent font-medium hover:underline">
          Цифры за период →
        </Link>
      </div>
    </div>
  );
}

/** Одна цифра в карточке «Склад за сегодня». */
function DayStat({ label, value, note, tone, className }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad"; className?: string }) {
  return (
    <div className={clsx("px-4 sm:px-5 py-4 min-w-0", className)}>
      <div className="text-[12.5px] leading-4 text-ink-secondary">{label}</div>
      <div className="font-display font-semibold text-[20px] sm:text-[22px] tabular-nums mt-2 leading-none">{value}</div>
      <div className={clsx("text-xs leading-4 mt-2", tone === "bad" ? "text-status-critical" : tone === "warn" ? "text-[#8a5a00]" : tone === "good" ? "text-status-good" : "text-ink-muted")}>{note}</div>
    </div>
  );
}

/** «1 заявка, 2 заявки, 5 заявок». */
function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «роза 7 · хризантема 18 · эустома 10 дн.» — сроки хранения из настроек, для подсказки «Сколько дней лежит». */
function shelfNoteOf(settings: { shelfLifeDays: Record<string, number> }, types: string[] = ["rose", "chrysanthemum", "chrysanthemum_rf", "eustoma"]): string {
  const name: Record<string, string> = { rose: "роза", chrysanthemum: "хризантема", chrysanthemum_rf: "хризантема Rose Farm", eustoma: "эустома" };
  return types.filter((t) => settings.shelfLifeDays[t]).map((t) => `${name[t] ?? t} ${settings.shelfLifeDays[t]}`).join(" · ") + " дн.";
}
