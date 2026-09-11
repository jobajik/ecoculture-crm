"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { FinanceOrderRow, FinanceSnapshot } from "@/lib/finance";
import {
  PAYMENT_STAGES,
  STAGE_HINTS,
  STAGE_LABELS,
  STAGE_SHORT,
  STAGE_TONES,
  matchesOrderSearch,
  type PaymentStage,
} from "@/lib/paymentStage";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import PaymentPanel, { PaymentState, money } from "./PaymentPanel";

type Filter = "all" | "noinvoice" | "unpaid" | "partial" | "paid" | "ready";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Все",
  noinvoice: "Счёт не отправлен",
  unpaid: "Не оплачены",
  partial: "Оплачены частично",
  paid: "Оплачены",
  ready: "Готовы к сборке",
};

/** Сколько колонок в таблице — под colSpan. */
const COLS = 9;

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
  // Какая заявка сейчас раскрыта на оплату. Одна за раз: панель занимает
  // строку, и две открытые превращают таблицу в лестницу.
  const [openId, setOpenId] = useState<string | null>(null);
  // Какие менеджеры раскрыты. По умолчанию — никто: страница открывается
  // короткой таблицей итогов.
  const [openManagers, setOpenManagers] = useState<Set<string>>(new Set());
  // В каких группах человек попросил показать все строки (а не первые 12).
  const [fullGroups, setFullGroups] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return snapshot.orders.filter((r) => {
      if (filter === "noinvoice" && r.stage !== PAYMENT_STAGES.NEW) return false;
      if (filter === "unpaid" && r.paid) return false;
      if (filter === "partial" && r.stage !== PAYMENT_STAGES.PARTIAL) return false;
      if (filter === "paid" && !r.paid) return false;
      if (filter === "ready" && !r.readyToCollect) return false;
      return matchesOrderSearch(r, search);
    });
  }, [snapshot.orders, filter, search]);

  // Разрез по менеджерам считается из ОТФИЛЬТРОВАННЫХ строк, а не из снимка:
  // иначе в шапке группы стояло бы «12 заявок», а внутри лежало три, и сойтись
  // это не могло бы никогда.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { managerEmail: string; managerName: string; rows: FinanceOrderRow[]; amount: number; paid: number }
    >();
    for (const r of rows) {
      const g = map.get(r.managerEmail) ?? {
        managerEmail: r.managerEmail,
        managerName: r.managerName,
        rows: [],
        amount: 0,
        paid: 0,
      };
      g.rows.push(r);
      g.amount += r.amount;
      g.paid += Math.min(r.paidAmount, r.amount);
      map.set(r.managerEmail, g);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [rows]);

  // Поиск сам раскрывает группы: свёрнутая группа с найденной заявкой читается
  // как «поиск ничего не нашёл».
  const searching = search.trim().length > 0;

  function toggleManager(email: string) {
    setOpenManagers((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  const t = snapshot.totals;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Оформлено за период" value={money(t.amount)} sub={`${t.orders} заявок`} />
        <Tile
          label="Получено"
          value={money(t.paidAmount)}
          sub={
            t.partlyPaidOrders > 0
              ? `${t.paidOrders} из ${t.orders} целиком, ${t.partlyPaidOrders} частично`
              : `${t.paidOrders} из ${t.orders}`
          }
          tone="good"
        />
        <Tile
          label="Ждём оплату"
          value={money(t.unpaidAmount)}
          sub={`${t.orders - t.paidOrders} заявок не закрыты`}
          tone={t.unpaidAmount > 0 ? "warning" : "default"}
        />
        <Tile
          label="Долг всего"
          value={money(snapshot.debtTotal)}
          sub={
            snapshot.debtOverdueTotal > 0
              ? `просрочено ${money(snapshot.debtOverdueTotal)}`
              : "по всей базе"
          }
          tone={snapshot.debtOverdueTotal > 0 ? "critical" : "default"}
        />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="font-medium">Собираемость за период</h3>
          <span className="text-sm text-ink-secondary tabular-nums">
            {t.collectPercent.toFixed(0)}% · {money(t.paidAmount)} из {money(t.amount)}
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-plane overflow-hidden">
          <div
            className="h-full rounded-full bg-status-good transition-all"
            style={{ width: `${Math.min(100, t.collectPercent)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                filter === f
                  ? "bg-accent text-white border-accent"
                  : "border-line-hairline text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <input
          className="input !w-auto flex-1 min-w-[200px] !py-1.5"
          placeholder="Номер заявки, клиент или менеджер"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {searching && (
        <p className="text-sm text-ink-muted -mt-2">
          Найдено заявок: {rows.length.toLocaleString("ru-RU")}. Номер заявки — последние пять
          знаков, он написан серым в колонке «№».
        </p>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Менеджер и заявка</th>
              <th className="px-3 py-3 font-medium">№</th>
              <th className="px-4 py-3 font-medium">Оформлена</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium text-center">
                Менеджер
                <br />
                подтвердил
              </th>
              <th className="px-4 py-3 font-medium">Статус оплаты</th>
              <th className="px-4 py-3 font-medium text-right">Получено</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const open = searching || openManagers.has(g.managerEmail);
              const full = fullGroups.has(g.managerEmail);
              const shown = open && !full ? g.rows.slice(0, COLLAPSED_TABLE_SIZE) : g.rows;
              const hidden = g.rows.length - shown.length;
              return (
                <Fragment key={g.managerEmail}>
                  <tr
                    className={clsx(
                      "border-b border-line-hairline bg-surface-plane/60",
                      !searching && "cursor-pointer hover:bg-surface-plane"
                    )}
                    onClick={() => !searching && toggleManager(g.managerEmail)}
                  >
                    <td className="px-4 py-2.5 font-medium" colSpan={4}>
                      <span className="text-ink-muted mr-2">{open ? "▾" : "▸"}</span>
                      {g.managerName}
                      <span className="text-ink-muted font-normal">
                        {" "}
                        · {g.rows.length} {orderWord(g.rows.length)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                      {money(g.amount)}
                    </td>
                    <td className="px-4 py-2.5" colSpan={2}>
                      {g.amount > 0 && (
                        <div className="h-1.5 rounded-full bg-surface-plane overflow-hidden max-w-[140px]">
                          <div
                            className="h-full rounded-full bg-status-good"
                            style={{ width: `${Math.min(100, (g.paid / g.amount) * 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-status-good whitespace-nowrap">
                      {money(g.paid)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-muted whitespace-nowrap">
                      {searching ? "" : open ? "свернуть" : "раскрыть"}
                    </td>
                  </tr>

                  {open &&
                    shown.map((r) => (
                      <Fragment key={r.orderId}>
                        <tr
                          className={clsx(
                            "border-b border-line-hairline hover:bg-surface-plane",
                            r.readyToCollect && "bg-status-good/5",
                            openId === r.orderId && "bg-accent-soft/40"
                          )}
                        >
                          <td className="px-4 py-2.5 pl-8">
                            <Link href={`/orders/${r.orderId}`} className="font-medium hover:underline">
                              {r.clientName}
                            </Link>
                            <div
                              className="text-xs text-ink-muted truncate max-w-[240px]"
                              title={r.positions}
                            >
                              {r.positions}
                            </div>
                          </td>
                          {/* Номер — служебная надпись: мелкий, серый, моноширинный.
                              Тот же приём, что с кодом партии на складе: он нужен,
                              только чтобы сверить строку с тем, что назвали. */}
                          <td className="px-3 py-2.5 font-mono text-xs text-ink-muted whitespace-nowrap">
                            {r.code}
                          </td>
                          <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                            {dateLabel(r.createdDate)}
                          </td>
                          <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                            {dateLabel(r.deliveryDate)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                            {money(r.amount)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span
                              className={clsx(
                                "text-base",
                                r.managerConfirmed ? "text-status-good" : "text-ink-muted"
                              )}
                            >
                              {r.managerConfirmed ? "✓" : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <StageBadge stage={r.stage} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-block text-right">
                              <PaymentState totalAmount={r.amount} paidAmount={r.paidAmount} compact />
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {canEdit ? (
                              <button
                                onClick={() => setOpenId(openId === r.orderId ? null : r.orderId)}
                                className="btn-secondary !py-1 !px-2.5 text-xs"
                              >
                                {openId === r.orderId ? "Закрыть" : r.paid ? "Изменить" : "Оплата"}
                              </button>
                            ) : (
                              <span className="text-xs text-ink-muted">только просмотр</span>
                            )}
                          </td>
                        </tr>
                        {openId === r.orderId && canEdit && (
                          <tr className="border-b border-line-hairline bg-accent-soft/20">
                            <td colSpan={COLS} className="px-4 py-4">
                              <PaymentPanel
                                orderId={r.orderId}
                                totalAmount={r.amount}
                                paidAmount={r.paidAmount}
                                farms={r.farms}
                                invoiceSentAt={r.invoiceSentAt}
                                onDone={() => setOpenId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}

                  {open && hidden > 0 && (
                    <tr className="border-b border-line-hairline">
                      <td colSpan={COLS} className="px-4 py-2 pl-8">
                        <MoreToggle
                          expanded={false}
                          hidden={hidden}
                          onToggle={() =>
                            setFullGroups((prev) => new Set(prev).add(g.managerEmail))
                          }
                          what="заявок"
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr>
                <td colSpan={COLS} className="px-4 py-10 text-center text-ink-muted">
                  Заявок по этому фильтру нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {groups.length > 0 && !searching && (
        <p className="text-sm text-ink-muted">
          Менеджеров: {groups.length} · заявок: {rows.length.toLocaleString("ru-RU")}. Нажмите на
          строку менеджера, чтобы раскрыть его заявки.
        </p>
      )}
    </div>
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

export function StageBadge({ stage, full = false }: { stage: PaymentStage; full?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-block rounded-md px-2 py-0.5 text-xs whitespace-nowrap",
        TONE_CLASS[STAGE_TONES[stage]]
      )}
      title={STAGE_HINTS[stage]}
    >
      {full ? STAGE_LABELS[stage] : STAGE_SHORT[stage]}
    </span>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warning" | "critical";
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
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div className={clsx("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
