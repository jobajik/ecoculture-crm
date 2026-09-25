"use client";

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
import MoreToggle from "./MoreToggle";
import Hint from "./Hint";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const LANE_PREVIEW = 6;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
  const q = query.trim();
  const lanes = board.lanes
    .filter((l) => lane === "all" || l.key === lane)
    .map((l) => ({
      ...l,
      rows: q
        ? l.rows.filter((r) => matchesOrderSearch(
                {
                  orderId: r.row.orderId,
                  clientName: r.row.clientName,
                  managerName: r.row.managerName,
                  amount: r.row.amount,
                  realization1c: r.row.realization1c,
                  amounts: [r.row.debt, ...(r.kaspi ? [r.kaspi.amount] : [])],
                },
                q
              ))
        : l.rows,
    }))
    .filter((l) => l.rows.length > 0);
  const totalOpen = board.lanes.reduce((s, l) => s + l.count, 0);
  const kw = board.kaspiWeek;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
        <LaneChip active={lane === "all"} onClick={() => setLane("all")} label="Все" count={totalOpen} />
        {board.lanes.map((l) => (
          <LaneChip
            key={l.key}
            active={lane === l.key}
            onClick={() => setLane(l.key)}
            label={l.label}
            count={l.count}
            dot={LANE_TONE[l.key].dot}
          />
        ))}
        </div>
        <input
          className="input !w-full sm:!w-56 sm:ml-auto"
          placeholder="Клиент, номер, сумма"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {lanes.length === 0 && (
        <p className="text-sm text-ink-muted card">
          {q ? "Ничего не нашлось." : totalOpen === 0 ? "Все счета оплачены." : "В этой дорожке пусто."}
        </p>
      )}

      {lanes.map((l) => {
        const showAll = expanded[l.key] || !!q || lane !== "all";
        const visible = showAll ? l.rows : l.rows.slice(0, LANE_PREVIEW);
        return (
          <section key={l.key} className="card !p-0 overflow-hidden">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 border-b border-line-hairline">
              <span className={clsx("w-2 h-2 rounded-full self-center", LANE_TONE[l.key].dot)} />
              <h2 className="text-sm font-semibold">{l.label}</h2>
              <span className="text-sm tabular-nums text-ink-secondary">
                {l.rows.length} · {money(l.rows.reduce((s, r) => s + r.row.debt, 0))}
              </span>
              <span className="text-xs text-ink-muted">{l.hint}</span>
            </header>
            <ul className="divide-y divide-line-hairline">
              {visible.map((r) => (
                <StatusItem
                  key={r.row.orderId}
                  r={r}
                  canEdit={canEdit}
                  kaspi={r.row.farms.some((f) => kaspiFarms.includes(f.farm) && f.amount - f.paidAmount > 1)}
                  open={openId === r.row.orderId}
                  onToggle={() => setOpenId(openId === r.row.orderId ? null : r.row.orderId)}
                />
              ))}
            </ul>
            {!showAll && l.rows.length > LANE_PREVIEW && (
              <div className="px-4 py-2 border-t border-line-hairline">
                <MoreToggle
                  expanded={false}
                  hidden={l.rows.length - LANE_PREVIEW}
                  onToggle={() => setExpanded((e) => ({ ...e, [l.key]: true }))}
                  what="заявок"
                />
              </div>
            )}
          </section>
        );
      })}

      {board.paidToday.rows.length > 0 && (
        <section className="card !p-0 overflow-hidden">
          <header className="px-4 py-3 border-b border-line-hairline flex items-baseline gap-3">
            <span className="w-2 h-2 rounded-full self-center bg-status-good" />
            <h2 className="text-sm font-semibold">Пришло сегодня</h2>
            <span className="text-sm tabular-nums text-ink-secondary">{money(board.paidToday.amount)}</span>
          </header>
          <ul className="divide-y divide-line-hairline">
            {board.paidToday.rows.map((p, i) => (
              <li key={`${p.orderId}-${i}`} className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium min-w-0 truncate">{p.clientName || "(без названия)"}</span>
                <Link href={`/orders/${p.orderId}`} className="text-xs font-mono text-ink-muted hover:text-accent">
                  {p.code}
                </Link>
                <span className="text-xs text-ink-muted">{p.method}</span>
                {p.viaKaspi && (
                  <span className="text-[11px] rounded-full px-2 py-0.5 bg-accent-soft text-accent">
                    Kaspi-счёт · проведено само
                  </span>
                )}
                <span className="ml-auto tabular-nums font-medium text-status-good">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-1 items-center">
        <span>
          Kaspi за 7 дней: выставлено {kw.sent} на {money(kw.sentAmount)}, оплачено {kw.paid} на {money(kw.paidAmount)}
          {kw.sent > 0 && ` (${Math.round((kw.paid / kw.sent) * 100)} %)`}
        </span>
        <span>
          · обновлено {formatMoment(generatedAt)}{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => router.refresh()}>
            обновить
          </button>
          <Hint>
            Страница обновляется сама раз в полторы минуты, пока открыта. Оплаченный Kaspi-счёт проводится
            платежом без бухгалтера. Долг — остаток по заявке; реализация (пожарка) и наши магазины сюда не
            попадают. «Нет отметки» — счёт не выставлен или отправлен мимо программы.
          </Hint>
        </span>
      </p>
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
      <div className={clsx("text-2xl font-semibold tabular-nums mt-0.5", valueTone)}>{value}</div>
      <div className="text-xs text-ink-muted mt-0.5 truncate">{sub}</div>
    </Tag>
  );
}

function LaneChip({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm min-h-[36px]",
        active ? "border-accent bg-accent-soft text-ink-primary" : "border-line-hairline text-ink-secondary hover:bg-surface"
      )}
    >
      {dot && <span className={clsx("w-1.5 h-1.5 rounded-full", dot)} />}
      {label}
      <span className="tabular-nums text-ink-muted">{count}</span>
    </button>
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
      return r.row.invoiceNote
        ? `заметка: ${r.row.invoiceNote}`
        : r.row.deliveryDate
          ? `доставка ${formatDay(r.row.deliveryDate)}`
          : "без даты доставки";
  }
}

function StatusItem({
  r,
  canEdit,
  kaspi,
  open,
  onToggle,
}: {
  r: StatusRow;
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
          <div className={clsx("text-xs truncate", LANE_TONE[r.lane].text)}>{statusText(r)}</div>
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
