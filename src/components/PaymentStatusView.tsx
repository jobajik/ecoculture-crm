"use client";

import { moneyExact } from "@/lib/formatNumber";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { PaymentStatusBoard, StatusLane, StatusRow } from "@/lib/paymentStatus";
import { prettyKaspiPhone, waitingWords } from "@/lib/kaspiInvoice";
import { matchesOrderSearch } from "@/lib/paymentStage";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { DEBT_OVERDUE_DAYS } from "@/lib/constants";
import PaymentPanel from "./PaymentPanel";
import InvoiceCell from "./InvoiceCell";
import Pager, { pageSlice } from "./Pager";
import Chips from "./Chips";
import Hint from "./Hint";

const money = moneyExact;
/** «Пришло сегодня» в боковой колонке — короткими порциями. */
const TODAY_PAGE = 6;
/** Страница сама перечитывает данные, пока открыта: Kaspi-оплаты приходят без бухгалтера. */
const AUTO_REFRESH_MS = 90_000;

const LANE_TONE: Record<StatusLane, { dot: string; text: string }> = {
  kaspi_problem: { dot: "bg-status-critical", text: "text-status-critical" },
  no_invoice: { dot: "bg-ink-muted", text: "text-ink-secondary" },
  kaspi_pending: { dot: "bg-accent", text: "text-accent" },
  invoiced: { dot: "bg-status-warning", text: "text-[#8a5a00]" },
  partial: { dot: "bg-[#8a5a00]", text: "text-[#8a5a00]" },
};

/**
 * «Статус оплат» — одна доска на все неоплаченные счета.
 *
 * Сверху четыре плитки на главные вопросы дня (что висит в Kaspi, что не
 * дошло, где нет счёта, что пришло сегодня) — они же фильтр. Ниже дорожки:
 * заявка стоит ровно в одной, и дорожка говорит, чей ход. Бухгалтер раскрывает
 * строку и тут же выставляет Kaspi-счёт той же панелью, что на заявке.
 */
export default function PaymentStatusView({
  board,
  canEdit,
  generatedAt,
  kaspiFarms,
}: {
  board: PaymentStatusBoard;
  canEdit: boolean;
  generatedAt: string;
  /** Компании с подключённой кассой Kaspi — у их заявок кнопка «Выставить». */
  kaspiFarms: string[];
}) {
  const router = useRouter();
  const [lane, setLane] = useState<StatusLane | "all">("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [todayPage, setTodayPage] = useState(0);

  // Пока открыта панель заявки, страницу не перечитываем: введённое не должно
  // пропадать из-под рук (грабли 1.20).
  useEffect(() => {
    if (openId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [openId, router]);

  const byKey = useMemo(() => Object.fromEntries(board.lanes.map((l) => [l.key, l])), [board.lanes]);
  const laneLabel = useMemo(
    () => Object.fromEntries(board.lanes.map((l) => [l.key, l.label])) as Record<StatusLane, string>,
    [board.lanes]
  );
  const q = query.trim();
  // Одна таблица вместо стопки дорожек: «Все» — дорожки подряд в их порядке (Kaspi не дошёл сверху),
  // выбранная дорожка — только она. Дорожка видна цветной строкой статуса и меткой у строки.
  const rows = board.lanes
    .filter((l) => lane === "all" || l.key === lane)
    .flatMap((l) => l.rows)
    .filter(
      (r) =>
        !q ||
        matchesOrderSearch(
          {
            orderId: r.row.orderId,
            clientName: r.row.clientName,
            managerName: r.row.managerName,
            amount: r.row.amount,
            realization1c: r.row.realization1c,
            amounts: [r.row.debt, ...(r.kaspi ? [r.kaspi.amount] : [])],
          },
          q
        )
    );
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [lane, query]);
  const shown = pageSlice(rows, page);
  const rowsDebt = rows.reduce((s, r) => s + r.row.debt, 0);
  const totalOpen = board.lanes.reduce((s, l) => s + l.count, 0);
  const kw = board.kaspiWeek;
  const laneHint = lane === "all" ? "" : byKey[lane]?.hint ?? "";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Tile
          active={lane === "kaspi_pending"}
          onClick={() => setLane(lane === "kaspi_pending" ? "all" : "kaspi_pending")}
          label="Ждём оплату в Kaspi"
          value={String(byKey.kaspi_pending.count)}
          sub={byKey.kaspi_pending.count ? money(byKey.kaspi_pending.amount) : "счетов в пути нет"}
          tone="accent"
        />
        <Tile
          active={lane === "kaspi_problem"}
          onClick={() => setLane(lane === "kaspi_problem" ? "all" : "kaspi_problem")}
          label="Kaspi не дошёл"
          value={String(byKey.kaspi_problem.count)}
          sub={byKey.kaspi_problem.count ? "выставить заново" : "всё в порядке"}
          tone={byKey.kaspi_problem.count ? "critical" : "muted"}
        />
        <Tile
          active={lane === "no_invoice"}
          onClick={() => setLane(lane === "no_invoice" ? "all" : "no_invoice")}
          label="Нет отметки о счёте"
          value={String(byKey.no_invoice.count)}
          sub={byKey.no_invoice.count ? money(byKey.no_invoice.amount) : "по всем выставлено"}
        />
        <Tile
          label="Пришло сегодня"
          value={money(board.paidToday.amount)}
          sub={
            board.paidToday.count
              ? `${board.paidToday.count} плат.${board.paidToday.kaspiAmount ? ` · Kaspi ${money(board.paidToday.kaspiAmount)}` : ""}`
              : "пока ничего"
          }
          tone={board.paidToday.amount > 0 ? "good" : "muted"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line-hairline flex flex-col lg:flex-row lg:items-center gap-2">
            <Chips
              className="min-w-0 flex-1"
              value={lane}
              onChange={(v) => setLane(v as StatusLane | "all")}
              items={[
                { value: "all", label: "Все", count: totalOpen },
                ...board.lanes.map((l) => ({
                  value: l.key,
                  label: l.label,
                  count: l.count,
                  alarm: l.key === "kaspi_problem",
                })),
              ]}
            />
            <input
              className="input !w-full lg:!w-56 flex-none"
              placeholder="Клиент, номер, сумма"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {rows.length > 0 && (
            <div className="px-4 py-2 border-b border-line-hairline text-xs text-ink-muted flex flex-wrap gap-x-2">
              <span>
                {rows.length} {lane === "all" ? "неоплаченных" : "в дорожке"} · долг{" "}
                <b className="text-ink-primary tabular-nums">{money(rowsDebt)}</b>
              </span>
              {laneHint && <span>· {laneHint}</span>}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted px-4 py-6">
              {q ? "Ничего не нашлось." : totalOpen === 0 ? "Все счета оплачены." : "В этой дорожке пусто."}
            </p>
          ) : (
            <ul className="divide-y divide-line-hairline">
              {shown.map((r) => (
                <StatusItem
                  key={r.row.orderId}
                  r={r}
                  laneLabel={lane === "all" ? laneLabel[r.lane] : ""}
                  canEdit={canEdit}
                  kaspi={r.row.farms.some((f) => kaspiFarms.includes(f.farm) && f.amount - f.paidAmount > 1)}
                  open={openId === r.row.orderId}
                  onToggle={() => setOpenId(openId === r.row.orderId ? null : r.row.orderId)}
                />
              ))}
            </ul>
          )}
          <Pager total={rows.length} page={page} onPage={setPage} what="заявок" />
        </div>

        <div className="space-y-5">
          <section className="card !p-0 overflow-hidden">
            <header className="px-4 py-3 border-b border-line-hairline flex items-baseline gap-3">
              <span className="w-2 h-2 rounded-full self-center bg-status-good" />
              <h2 className="text-sm font-semibold">Пришло сегодня</h2>
              <span className="ml-auto text-sm tabular-nums font-semibold text-status-good">
                {money(board.paidToday.amount)}
              </span>
            </header>
            {board.paidToday.rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">Пока ничего.</p>
            ) : (
              <>
                <ul className="divide-y divide-line-hairline">
                  {pageSlice(board.paidToday.rows, todayPage, TODAY_PAGE).map((p, i) => (
                    <li key={`${p.orderId}-${i}`} className="px-4 py-2.5 text-sm">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-medium min-w-0 truncate">{p.clientName || "(без названия)"}</span>
                        <span className="ml-auto tabular-nums font-medium text-status-good flex-none">{money(p.amount)}</span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted">
                        <Link href={`/orders/${p.orderId}`} className="font-mono hover:text-accent">
                          {p.code}
                        </Link>
                        <span>{p.method}</span>
                        {p.viaKaspi && <span className="text-accent">Kaspi-счёт · проведено само</span>}
                      </div>
                    </li>
                  ))}
                </ul>
                <Pager
                  total={board.paidToday.rows.length}
                  page={todayPage}
                  onPage={setTodayPage}
                  size={TODAY_PAGE}
                  what="платежей"
                />
              </>
            )}
          </section>

          <section className="card !p-4 text-sm space-y-1">
            <div className="text-xs text-ink-muted">Kaspi за 7 дней</div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-secondary">Выставлено</span>
              <span className="tabular-nums">
                {kw.sent} · {money(kw.sentAmount)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-ink-secondary">Оплачено</span>
              <span className="tabular-nums">
                {kw.paid} · {money(kw.paidAmount)}
                {kw.sent > 0 && ` (${Math.round((kw.paid / kw.sent) * 100)} %)`}
              </span>
            </div>
            <div className="text-xs text-ink-muted pt-2 border-t border-line-hairline mt-2">
              Обновлено {formatMoment(generatedAt)} ·{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => router.refresh()}>
                обновить
              </button>
              <Hint>
                Страница обновляется сама раз в полторы минуты, пока открыта. Оплаченный Kaspi-счёт проводится
                платежом без бухгалтера. Долг — остаток по заявке; реализация (пожарка) и наши магазины сюда не
                попадают. «Нет отметки» — счёт не выставлен или отправлен мимо программы.
              </Hint>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone = "default",
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "accent" | "critical" | "good" | "muted";
  active?: boolean;
  onClick?: () => void;
}) {
  const valueTone =
    tone === "accent"
      ? "text-accent"
      : tone === "critical"
        ? "text-status-critical"
        : tone === "good"
          ? "text-status-good"
          : tone === "muted"
            ? "text-ink-muted"
            : "text-ink-primary";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": !!active } : {})}
      className={clsx(
        "card !p-4 text-left transition-colors",
        onClick && "hover:border-line-strong",
        active && "!border-accent ring-1 ring-accent"
      )}
    >
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className={clsx("font-display text-2xl font-extrabold tabular-nums mt-0.5", valueTone)}>{value}</div>
      <div className="text-xs text-ink-muted mt-0.5 truncate">{sub}</div>
    </Tag>
  );
}

function statusText(r: StatusRow): string {
  const k = r.kaspi;
  switch (r.lane) {
    case "kaspi_pending":
      return k
        ? `Kaspi-счёт ${money(k.amount)} на ${prettyKaspiPhone(k.phone)} · ${k.statusLabel}, ${waitingWords(k.createdAt)}`
        : "Kaspi-счёт в пути";
    case "kaspi_problem":
      return k ? `${k.problem || k.statusLabel} · ${formatMoment(k.createdAt)}` : "Kaspi-счёт не дошёл";
    case "invoiced":
      return `счёт отправлен ${formatMoment(r.row.invoiceSentAt)}`;
    case "partial":
      return `получено ${money(r.row.paidAmount)} из ${money(r.row.amount)}`;
    default:
      // Заметку «почему не ушёл» показывает InvoiceCell в той же строке.
      return r.row.deliveryDate
          ? `доставка ${formatDay(r.row.deliveryDate)}`
          : "без даты доставки";
  }
}

function StatusItem({
  r,
  laneLabel,
  canEdit,
  kaspi,
  open,
  onToggle,
}: {
  r: StatusRow;
  /** Название дорожки — только в общем списке «Все». */
  laneLabel: string;
  canEdit: boolean;
  kaspi: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const late = r.days > DEBT_OVERDUE_DAYS;
  return (
    <li>
      <div className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-medium truncate min-w-0">{r.row.clientName || "(без названия)"}</span>
            <Link
              href={`/orders/${r.row.orderId}`}
              className="text-xs font-mono text-ink-muted hover:text-accent flex-none"
            >
              {r.row.code}
            </Link>
          </div>
          <div className={clsx("text-xs truncate", LANE_TONE[r.lane].text)}>
            {laneLabel && (
              <span className="inline-flex items-center gap-1 mr-1.5 font-medium">
                <span className={clsx("w-1.5 h-1.5 rounded-full", LANE_TONE[r.lane].dot)} />
                {laneLabel} ·
              </span>
            )}
            {statusText(r)}
          </div>
          {/* «Нет отметки о счёте»: отметить отправленный счёт или записать, почему
              не ушёл, — прямо в строке, как в «Оплатах», не раскрывая панель. */}
          {r.lane === "no_invoice" && (
            <div className="mt-1">
              <InvoiceCell
                orderId={r.row.orderId}
                stage={r.row.stage}
                invoiceSentAt={r.row.invoiceSentAt}
                invoiceNote={r.row.invoiceNote}
                canEdit={canEdit}
              />
            </div>
          )}
        </div>
        <div className="text-xs text-ink-muted truncate sm:w-32 flex-none">{r.row.managerName}</div>
        <div className="text-right flex-none sm:w-28 ml-auto sm:ml-0">
          <div className="tabular-nums font-semibold">{money(r.row.debt)}</div>
          <div className={clsx("text-[11px] tabular-nums", late ? "text-status-critical" : "text-ink-muted")}>
            {r.days} дн.
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={clsx("btn-secondary !py-1.5 !px-3 flex-none w-full sm:w-28", open && "!bg-surface-plane")}
          >
            {open
              ? "Свернуть"
              : kaspi && (r.lane === "kaspi_problem" || r.lane === "no_invoice")
                ? "Выставить"
                : kaspi || r.lane === "kaspi_pending"
                  ? "Открыть"
                  : "Внести"}
          </button>
        ) : (
          <Link href={`/orders/${r.row.orderId}`} className="text-sm text-accent hover:underline flex-none sm:w-28 text-right">
            Заявка
          </Link>
        )}
      </div>
      {open && canEdit && (
        <div className="px-4 pb-4 pt-1 bg-surface-plane/60 border-t border-line-hairline">
          <PaymentPanel
            orderId={r.row.orderId}
            totalAmount={r.row.amount}
            paidAmount={r.row.paidAmount}
            farms={r.row.farms}
            invoiceSentAt={r.row.invoiceSentAt}
            payments={r.row.payments}
            realizations={r.row.realizations}
            defaultMethod={r.row.paymentMethod}
            status={r.row.status}
            consignment={r.row.consignment}
          />
        </div>
      )}
    </li>
  );
}
