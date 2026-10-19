"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { FinanceOrderRow, FinanceSnapshot } from "@/lib/finance";
import { PAYMENT_STAGES, matchesOrderSearch } from "@/lib/paymentStage";
import Pager, { pageSlice } from "./Pager";
import Chips from "./Chips";
import PaymentPanel, { PaymentState, money } from "./PaymentPanel";
import InvoiceCell from "./InvoiceCell";
import CashByFlowerCard from "./CashByFlowerCard";
import StageBadge from "./StageBadge";
import { FINANCE_FARMS, managerFarmSummary, managerOptions } from "@/lib/financeManagers";

type Filter = "all" | "noinvoice" | "unpaid" | "partial" | "paid" | "ready" | "overpaid";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Все",
  noinvoice: "Нет отметки о счёте",
  unpaid: "Не оплачены",
  partial: "Оплачены частично",
  paid: "Оплачены",
  ready: "Готовы к отгрузке",
  // Переплата — по всей базе, а не за период: вернуть её надо, когда бы ни
  // оформили заявку (snapshot.overpaidRows).
  overpaid: "Переплата",
};

/** Сколько колонок в таблице — под colSpan. */
const COLS = 6;

function dateLabel(key: string): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

const TONE_CLASS: Record<string, string> = {
  muted: "text-ink-muted bg-surface-plane",
  warning: "text-[#8a5a00] bg-status-warning/10",
  partial: "text-accent bg-accent-soft",
  good: "text-status-good bg-status-good/10",
};

/**
 * Оплаты бухгалтера.
 *
 * Три вещи, которые здесь легко сломать обратно:
 *
 * 1. **Заявки сгруппированы по менеджерам и группы СВЁРНУТЫ.** Так решил
 *    владелец: сверху видно всех менеджеров одной короткой таблицей — сколько
 *    заявок, на сколько, сколько получено, — и нужного раскрываешь одним
 *    нажатием. Раньше это было сплошное полотно строк, где разрез по менеджерам
 *    приходилось складывать глазами.
 * 2. **При поиске группы раскрываются САМИ.** Свёрнутая группа с найденной
 *    заявкой — это ровно тот случай, когда человек решает, что поиск не
 *    работает. Та же причина, по которой длинные списки в программе не
 *    сворачиваются, когда включён фильтр.
 * 3. **Стадия оплаты — не галочка, а цепочка**: счёт не отправлен → счёт
 *    отправлен → часть денег → оплачено. Правила в `src/lib/paymentStage.ts`.
 */
export default function FinanceBoard({
  snapshot,
  canEdit,
}: {
  snapshot: FinanceSnapshot;
  /** Отмечать оплату может только бухгалтер и админ; остальным — только смотреть. */
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [search, setSearch] = useState("");
  // Фильтр по менеджеру (просьба бухгалтера): пусто — все.
  const [manager, setManager] = useState("");
  // Какая заявка сейчас раскрыта на оплату. Одна за раз: панель занимает
  // строку, и две открытые превращают таблицу в лестницу.
  const [openId, setOpenId] = useState<string | null>(null);
  // Вкладка карточки: список заявок или разрез по менеджерам и компаниям (новый вид, 19.10.2026: «одностраничный»).
  const [view, setView] = useState<"list" | "managers">("list");
  const [page, setPage] = useState(0);

  // «Переплата» смотрит на всю базу, остальные отборы — на заявки периода.
  const source = filter === "overpaid" ? snapshot.overpaidRows : snapshot.orders;
  const rows = useMemo(() => {
    return source.filter((r) => {
      if (manager && r.managerEmail !== manager) return false;
      if (filter === "noinvoice" && r.stage !== PAYMENT_STAGES.NEW) return false;
      if (filter === "unpaid" && r.paid) return false;
      if (filter === "partial" && r.stage !== PAYMENT_STAGES.PARTIAL) return false;
      if (filter === "paid" && !r.paid) return false;
      if (filter === "ready" && !r.readyToCollect) return false;
      return matchesOrderSearch(
        {
          ...r,
          amounts: [
            ...r.byFlower.map((f) => f.amount),
            ...r.farms.map((f) => f.amount),
            ...r.farms.map((f) => f.amount - f.paidAmount),
            r.debt,
            ...r.payments.map((p) => p.amount),
          ],
        },
        search
      );
    });
  }, [source, filter, search, manager]);

  const managers = useMemo(
    () => managerOptions([...snapshot.orders, ...snapshot.overpaidRows]),
    [snapshot.orders, snapshot.overpaidRows]
  );
  // Продажи каждого менеджера по компаниям — из тех же отфильтрованных строк, что и список ниже.
  const byManager = useMemo(() => managerFarmSummary(rows), [rows]);

  // Счётчики на кнопках отбора — по выбранному менеджеру, без поиска.
  const counts = useMemo(() => {
    const base = snapshot.orders.filter((r) => !manager || r.managerEmail === manager);
    return {
      all: base.length,
      noinvoice: base.filter((r) => r.stage === PAYMENT_STAGES.NEW).length,
      unpaid: base.filter((r) => !r.paid).length,
      partial: base.filter((r) => r.stage === PAYMENT_STAGES.PARTIAL).length,
      paid: base.filter((r) => r.paid).length,
      ready: base.filter((r) => r.readyToCollect).length,
      overpaid: snapshot.overpaidRows.filter((r) => !manager || r.managerEmail === manager).length,
    } as Record<Filter, number>;
  }, [snapshot.orders, snapshot.overpaidRows, manager]);

  // Новый отбор — с первой страницы; открытая панель оплаты закрывается.
  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [filter, search, manager]);
  const shown = pageSlice(rows, page);

  const t = snapshot.totals;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile label="Оформлено за период" value={money(t.amount)} sub={`${t.orders} ${orderWord(t.orders)}`} />
        <Tile
          label="Получено"
          value={money(t.paidAmount)}
          sub={
            t.partlyPaidOrders > 0
              ? `${t.paidOrders} из ${t.orders} целиком, ${t.partlyPaidOrders} частично`
              : `${t.paidOrders} из ${t.orders} · собрано ${t.collectPercent.toFixed(0)} %`
          }
          tone="good"
          bar={t.collectPercent}
        />
        <Tile
          label="Ждём оплату"
          value={money(t.unpaidAmount)}
          sub={`${t.orders - t.paidOrders} ${orderWord(t.orders - t.paidOrders)} не закрыто`}
          tone={t.unpaidAmount > 0 ? "warning" : "default"}
        />
        <Tile
          label="Всего долг"
          value={money(snapshot.debtTotal)}
          sub={snapshot.debtOverdueTotal > 0 ? `просрочено ${money(snapshot.debtOverdueTotal)}` : "по всей базе"}
          tone={snapshot.debtOverdueTotal > 0 ? "critical" : "default"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="card !p-0 overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
            {(
              [
                ["list", `Заявки (${rows.length.toLocaleString("ru-RU")})`],
                ["managers", "По менеджерам и компаниям"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={clsx(
                  "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                  view === key
                    ? "border-section-money text-ink-primary font-semibold"
                    : "border-transparent text-ink-secondary hover:text-ink-primary"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
            <Chips
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              items={(Object.keys(FILTER_LABELS) as Filter[]).map((f) => ({
                value: f,
                label: FILTER_LABELS[f],
                count: counts[f],
                alarm: f === "overpaid",
              }))}
            />
            <div className="flex gap-2 2xl:ml-auto 2xl:flex-none">
              <input
                className="input !w-auto flex-1 2xl:w-[220px] min-w-0"
                placeholder="Клиент, №, 1С или сумма"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className="input !w-auto" value={manager} onChange={(e) => setManager(e.target.value)} aria-label="Менеджер">
                <option value="">Все менеджеры</option>
                {managers.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filter === "overpaid" && (
            <p className="px-4 py-2 text-xs text-ink-muted border-b border-line-hairline">
              Переплаты по всей базе, не только за период: деньги надо вернуть или зачесть.
            </p>
          )}

          {view === "managers" ? (
            byManager.rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">По этому отбору заявок нет</p>
            ) : (
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                      <th className="px-4 py-2.5 font-medium">
                        Менеджер <span className="font-normal">· сумма заявок, под ней получено</span>
                      </th>
                      {FINANCE_FARMS.map((f) => (
                        <th key={f.farm} className="px-4 py-2.5 font-medium text-right">
                          {f.label}
                        </th>
                      ))}
                      <th className="px-4 py-2.5 font-medium text-right">Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byManager.rows.map((m) => (
                      <tr
                        key={m.managerEmail}
                        className={clsx(
                          "border-b border-line-hairline cursor-pointer hover:bg-surface-plane",
                          manager === m.managerEmail && "bg-section-money-soft/60"
                        )}
                        title="Показать заявки этого менеджера"
                        onClick={() => {
                          setManager(m.managerEmail);
                          setView("list");
                        }}
                      >
                        <td className="px-4 py-2.5 font-semibold">
                          {m.managerName}
                          <span className="text-ink-muted font-normal">
                            {" "}
                            · {m.orders} {orderWord(m.orders)}
                          </span>
                        </td>
                        {FINANCE_FARMS.map((f) => (
                          <MoneyCell key={f.farm} label={f.label} cell={m.byFarm[f.farm]} />
                        ))}
                        <MoneyCell label="Итого" cell={{ amount: m.amount, paid: m.paid }} strong />
                      </tr>
                    ))}
                    {byManager.rows.length > 1 && (
                      <tr className="bg-surface-plane/60">
                        <td className="px-4 py-2.5 font-semibold">Всего</td>
                        {FINANCE_FARMS.map((f) => (
                          <MoneyCell key={f.farm} label={f.label} cell={byManager.total.byFarm[f.farm]} />
                        ))}
                        <MoneyCell label="Итого" cell={{ amount: byManager.total.amount, paid: byManager.total.paid }} strong />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <>
              {/* На телефоне строки — карточки (`table-cards`): кнопка «Оплата» видна без боковой прокрутки. */}
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                      <th className="px-4 py-2.5 font-medium w-full">Клиент · менеджер</th>
                      <th className="px-3 py-2.5 font-medium">№</th>
                      <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Оформлена · доставка</th>
                      <th className="px-3 py-2.5 font-medium text-right">Сумма · получено</th>
                      <th className="px-3 py-2.5 font-medium">Счёт</th>
                      <th className="px-3 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <Fragment key={r.orderId}>
                        <tr
                          className={clsx(
                            "border-b border-line-hairline hover:bg-surface-plane align-top",
                            openId === r.orderId && "bg-section-money-soft/50"
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5">
                              {/* Галочка менеджера — у имени клиента, а не отдельной колонкой. */}
                              <span
                                className={clsx("text-xs shrink-0", r.managerConfirmed ? "text-status-good" : "text-ink-muted")}
                                title={r.managerConfirmed ? "Менеджер подтвердил заявку" : "Менеджер ещё не подтвердил заявку"}
                              >
                                {r.managerConfirmed ? "✓" : "○"}
                              </span>
                              <Link href={`/orders/${r.orderId}`} className="font-semibold hover:text-accent truncate max-w-[260px]">
                                {r.clientName}
                              </Link>
                              {r.readyToCollect && (
                                <span className="text-[11px] font-semibold text-status-good whitespace-nowrap">· можно собирать</span>
                              )}
                            </span>
                            <div className="text-xs text-ink-muted truncate max-w-[200px] sm:max-w-[440px] pl-5" title={r.positions}>
                              <span className="text-ink-secondary">{r.managerName}</span>
                              {r.consignment && <span className="text-[#8a5a00]"> · на реализации</span>}
                              {r.paymentMethod && !r.paid && <span> · {r.paymentMethod}</span>}
                              {" · "}
                              {r.positions}
                            </div>
                          </td>
                          {/* Номер — служебная надпись: мелкий, серый, моноширинный. Под ним — номер 1С. */}
                          <td data-label="№" className="px-3 py-2.5 font-mono text-xs text-ink-muted whitespace-nowrap">
                            {r.code}
                            {r.realizations
                              .filter((x) => x.number)
                              .map((x) => (
                                <div key={x.flowerType} className="text-[11px] text-ink-secondary" title={`№ реализации в 1С — ${x.label}`}>
                                  1С {r.realizations.length > 1 ? `${x.label.slice(0, 4)}. ` : ""}
                                  {x.number}
                                </div>
                              ))}
                          </td>
                          <td
                            data-label="Оформлена / доставка"
                            className="px-3 py-2.5 text-xs text-ink-secondary whitespace-nowrap hidden sm:table-cell"
                          >
                            <div>{dateLabel(r.createdDate)}</div>
                            <div className="text-ink-muted">{dateLabel(r.deliveryDate)}</div>
                          </td>
                          <td data-label="Сумма" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            <div className="font-semibold">{money(r.amount)}</div>
                            {/* В смешанной заявке — сумма по каждому цветку: пришедшие 60 000 ищут как «хризантему». */}
                            {r.byFlower.length > 1 && (
                              <div className="text-[11px] text-ink-secondary">
                                {r.byFlower.map((f) => `${f.label} ${money(f.amount)}`).join(" · ")}
                              </div>
                            )}
                            <div className="text-xs">
                              <PaymentState totalAmount={r.amount} paidAmount={r.paidAmount} compact />
                            </div>
                          </td>
                          {/* Стадия счёта и отметка «отправлен» — прямо в строке. */}
                          <td data-label="Счёт" className="px-3 py-2.5">
                            <InvoiceCell
                              orderId={r.orderId}
                              stage={r.stage}
                              invoiceSentAt={r.invoiceSentAt}
                              invoiceNote={r.invoiceNote}
                              canEdit={canEdit}
                            />
                          </td>
                          <td data-label="Оплата" className="px-3 py-2.5 text-right whitespace-nowrap">
                            {canEdit ? (
                              <button
                                onClick={() => setOpenId(openId === r.orderId ? null : r.orderId)}
                                className={clsx(openId === r.orderId || r.paid ? "btn-secondary" : "btn-primary", "!py-1 !px-3 !min-h-0 text-xs")}
                              >
                                {openId === r.orderId ? "Закрыть" : r.paid ? "Изменить" : "Оплата"}
                              </button>
                            ) : (
                              <span className="text-xs text-ink-muted">просмотр</span>
                            )}
                          </td>
                        </tr>
                        {openId === r.orderId && canEdit && (
                          <tr className="border-b border-line-hairline bg-section-money-soft/30">
                            <td colSpan={COLS} className="px-4 py-4">
                              <PaymentPanel
                                orderId={r.orderId}
                                totalAmount={r.amount}
                                paidAmount={r.paidAmount}
                                farms={r.farms}
                                invoiceSentAt={r.invoiceSentAt}
                                payments={r.payments}
                                realizations={r.realizations}
                                defaultMethod={r.paymentMethod}
                                status={r.status}
                                consignment={r.consignment}
                                onDone={() => setOpenId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {/* Пустая таблица обязана сказать, ПОЧЕМУ она пустая. */}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={COLS} className="px-4 py-10 text-center">
                          {filter === "overpaid" && source.length === 0 ? (
                            <p className="font-medium">Переплат нет</p>
                          ) : source.length === 0 ? (
                            <>
                              <p className="font-medium">За этот период заявок нет</p>
                              <p className="text-sm text-ink-secondary mt-1">Старые долги — во вкладке «Долги и звонки».</p>
                            </>
                          ) : search.trim() ? (
                            <p className="font-medium">Ничего не нашлось</p>
                          ) : (
                            <>
                              <p className="font-medium">По этому отбору заявок нет</p>
                              <p className="text-sm text-ink-secondary mt-1">
                                Всего за период: {snapshot.orders.length.toLocaleString("ru-RU")}
                              </p>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pager total={rows.length} page={page} onPage={setPage} what="заявок" />
            </>
          )}
        </div>

        {/* Касса по цветкам — сбоку: владелец ведёт её в тетради («хриз. 20 000, роза 30 000»). */}
        <CashByFlowerCard cash={snapshot.cash} periodLabel={snapshot.periodLabel} />
      </div>
    </div>
  );
}

function MoneyCell({
  label,
  cell,
  strong,
}: {
  label: string;
  cell: { amount: number; paid: number } | undefined;
  strong?: boolean;
}) {
  const amount = cell?.amount ?? 0;
  return (
    <td data-label={label} className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
      {amount > 0 ? (
        <>
          <div className={strong ? "font-semibold" : undefined}>{money(amount)}</div>
          <div className="text-xs text-status-good">{money(cell?.paid ?? 0)}</div>
        </>
      ) : (
        <span className="text-ink-muted">—</span>
      )}
    </td>
  );
}

function orderWord(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last2 >= 11 && last2 <= 14) return "заявок";
  if (last === 1) return "заявка";
  if (last >= 2 && last <= 4) return "заявки";
  return "заявок";
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warning" | "critical";
  /** Полоска доли (собираемость), 0–100. */
  bar?: number;
}) {
  const toneClass =
    tone === "good"
      ? "text-status-good"
      : tone === "warning"
      ? "text-[#8a5a00]"
      : tone === "critical"
      ? "text-status-critical"
      : "text-ink-primary";

  return (
    <div className="card !p-4 sm:!p-5">
      <div className="text-xs text-ink-muted mb-1.5">{label}</div>
      <div className={clsx("font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums", toneClass)}>{value}</div>
      {bar !== undefined && (
        <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden mt-2.5">
          <div className="h-full rounded-full bg-status-good" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
      {sub && <div className="text-xs text-ink-secondary mt-2">{sub}</div>}
    </div>
  );
}
