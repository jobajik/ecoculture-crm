"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  cancelKaspiInvoiceAction,
  loadKaspiAction,
  refreshKaspiInvoiceAction,
  sendKaspiInvoiceAction,
  type KaspiPanelData,
} from "@/app/finance/kaspi-actions";
import {
  isOpenKaspiStatus,
  isPaidKaspiStatus,
  kaspiErrorText,
  kaspiPhone,
  kaspiStatusLabel,
  kaspiTrackerStep,
  prettyKaspiPhone,
  waitingWords,
} from "@/lib/kaspiInvoice";
import { formatMoment } from "@/lib/formatDate";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import type { KaspiInvoice } from "@/lib/types";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/** Пока счёт ждёт оплаты, статус спрашивается сам: первые 3 минуты — раз в 15 с, дальше — раз в минуту. */
const FAST_POLL_MS = 15_000;
const SLOW_POLL_MS = 60_000;
const FAST_POLLS = 12;

type Form = { choice: string; other: string; amount: string; editAmount: boolean };

/**
 * Счёт в Kaspi Pay — главное действие панели оплаты.
 *
 * Владелец: «тупо нажать кнопку, чтобы отправился счёт, и трекерить оплату;
 * нужно понимать, что можно выбрать номер из списка, если несколько каспи».
 * Поэтому: номера клиента — кнопками (Kaspi №1, №2, телефон заявки), сумма —
 * остаток по умолчанию и меняется только по «изменить», а после отправки вместо
 * формы стоит полоска «выставлен → у клиента → оплачен», которая обновляется
 * сама. Оплаченный счёт проводится платежом без бухгалтера (вебхук).
 *
 * `onState` сообщает панели, есть ли здесь что делать: если кассы нет или
 * платить нечего, панель сразу раскрывает ручной ввод платежа.
 */
export default function KaspiInvoiceBlock({
  orderId,
  onState,
}: {
  orderId: string;
  onState?: (state: "action" | "none") => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<KaspiPanelData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, Form>>({});
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = unwrapValue(await loadKaspiAction(orderId));
      setData(d);
      setForm((prev) => {
        const next = { ...prev };
        for (const f of d.farms) {
          if (!next[f.farm]) {
            // Прошлый счёт не дошёл, потому что номера нет в Kaspi, — сразу
            // предлагаем другой номер клиента, а не тот же самый.
            const last = d.invoices.find((i) => i.farm === f.farm);
            const badPhone = last?.status === "error" && last.errorCode === "client_not_found" ? last.phone : "";
            const first = d.phones.find((o) => o.phone !== badPhone) ?? d.phones[0];
            next[f.farm] = {
              choice: first?.phone ?? "",
              other: "",
              amount: f.due > 0 ? String(f.due) : "",
              editAmount: false,
            };
          }
        }
        return next;
      });
    } catch {
      setHidden(true);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const configured = data?.farms.filter((f) => f.configured) ?? [];
  const hasAction =
    !!data &&
    configured.some((f) => f.due > 0 || data.invoices.some((i) => i.farm === f.farm && isOpenKaspiStatus(i.status)));

  useEffect(() => {
    if (hidden) onState?.("none");
    else if (data) onState?.(hasAction ? "action" : "none");
  }, [data, hidden, hasAction, onState]);

  // Счёт висит — спрашиваем ApiPay сами, не дожидаясь вебхука: оплату видно
  // через секунды, а не после ручного «обновить».
  const openIds = (data?.invoices ?? []).filter((i) => isOpenKaspiStatus(i.status)).map((i) => i.invoiceId);
  const openKey = openIds.join(",");
  useEffect(() => {
    if (!openKey) {
      polls.current = 0;
      return;
    }
    const delay = polls.current < FAST_POLLS ? FAST_POLL_MS : SLOW_POLL_MS;
    const timer = setTimeout(async () => {
      polls.current += 1;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        setData((d) => (d ? { ...d } : d)); // перезапустить таймер
        return;
      }
      let changed = false;
      for (const id of openKey.split(",")) {
        try {
          const before = data?.invoices.find((i) => i.invoiceId === id)?.status;
          const r = unwrapValue(await refreshKaspiInvoiceAction(id));
          if (r.status && r.status !== before) changed = true;
        } catch {
          // Тихо: сбой связи не повод пугать бухгалтера, спросим в следующий раз.
        }
      }
      if (changed) {
        await load();
        router.refresh();
      } else {
        setData((d) => (d ? { ...d } : d));
      }
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, data]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      polls.current = 0;
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    } finally {
      setBusy(null);
    }
  }

  if (hidden || !data) return null;
  if (data.farms.length === 0 || (configured.length === 0 && data.invoices.length === 0)) return null;
  const several = data.farms.length > 1;

  return (
    // Красноватый фон — отсылка к Kaspi, как попросил владелец: блок узнаётся с
    // первого взгляда. Логотип Kaspi не рисуем — только цвет и название.
    <section className="rounded-xl border border-kaspi/25 bg-kaspi-soft p-3 sm:p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-kaspi px-2 py-0.5 text-xs font-bold text-white tracking-wide">Kaspi</span>
        <span className="text-sm font-semibold">Счёт на оплату</span>
        <span className="text-xs text-ink-muted">оплата проводится сама</span>
      </div>

      {data.farms.map((f) => {
        const invs = data.invoices.filter((i) => i.farm === f.farm);
        const open = invs.find((i) => isOpenKaspiStatus(i.status));
        const latest = invs[0];
        const v = form[f.farm];
        const head = several && (
          <div className="text-xs font-medium text-ink-secondary">
            {f.label} · {f.due > 0 ? `к оплате ${money(f.due)}` : "оплачено"}
          </div>
        );

        if (!f.configured) {
          return several ? (
            <p key={f.farm} className="text-xs text-ink-muted">
              {f.label}: касса Kaspi не подключена — платёж вносится вручную.
            </p>
          ) : null;
        }

        if (open) {
          return (
            <div key={f.farm} className="space-y-2">
              {head}
              <Tracker
                inv={open}
                busy={busy}
                onRefresh={() =>
                  run(`refresh-${open.invoiceId}`, async () => {
                    const r = unwrapValue(await refreshKaspiInvoiceAction(open.invoiceId));
                    return `Статус: ${kaspiStatusLabel(r.status)}`;
                  })
                }
                onCancel={() => {
                  if (!window.confirm(`Отменить счёт на ${money(open.amount)}? Клиент больше не сможет его оплатить.`)) return;
                  run(`cancel-${open.invoiceId}`, async () => {
                    unwrap(await cancelKaspiInvoiceAction(open.invoiceId));
                    return "Счёт отменяется.";
                  });
                }}
              />
            </div>
          );
        }

        if (f.due <= 0) {
          return (
            <div key={f.farm} className="space-y-2">
              {head}
              {latest && isPaidKaspiStatus(latest.status) ? (
                <Tracker inv={latest} busy={busy} />
              ) : (
                <p className="text-sm text-status-good">Оплачено.</p>
              )}
            </div>
          );
        }

        if (!v) return null;
        const phone = v.choice === "other" ? kaspiPhone(v.other) : v.choice;
        const amount = Number((v.editAmount ? v.amount : String(f.due)).replace(/\s/g, ""));
        const failed = latest && !isOpenKaspiStatus(latest.status) && !isPaidKaspiStatus(latest.status) ? latest : null;
        const set = (patch: Partial<Form>) => setForm((prev) => ({ ...prev, [f.farm]: { ...v, ...patch } }));

        return (
          <form
            key={f.farm}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(`send-${f.farm}`, async () => {
                const r = unwrapValue(await sendKaspiInvoiceAction({ orderId, farm: f.farm, phone, amount }));
                return r.sandbox
                  ? "Счёт создан в ТЕСТОВОМ режиме ApiPay — клиенту он не придёт."
                  : `Счёт отправлен на ${prettyKaspiPhone(phone)}. Клиенту придёт уведомление в Kaspi.`;
              });
            }}
          >
            {head}
            {failed && (
              <p className="text-xs rounded-lg bg-status-warning/10 text-[#8a5a00] px-3 py-2">
                Прошлый счёт: {kaspiStatusLabel(failed.status)}
                {failed.status === "error" && ` — ${kaspiErrorText(failed.errorCode, failed.errorMessage)}`}. Выставите
                новый.
              </p>
            )}

            <div>
              <div className="label">Номер клиента в Kaspi</div>
              <div className="flex flex-wrap gap-2">
                {data.phones.map((o) => (
                  <Chip key={o.phone} active={v.choice === o.phone} onClick={() => set({ choice: o.phone })}>
                    <span className="tabular-nums">{prettyKaspiPhone(o.phone)}</span>
                    <span className="text-[11px] opacity-70">{o.label}</span>
                  </Chip>
                ))}
                <Chip active={v.choice === "other"} onClick={() => set({ choice: "other" })}>
                  {data.phones.length ? "Другой номер" : "Вписать номер"}
                </Chip>
              </div>
              {data.phones.length === 0 && v.choice !== "other" && (
                <p className="text-xs text-ink-muted mt-1.5">В карточке клиента нет мобильного номера.</p>
              )}
              {v.choice === "other" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="input !w-52"
                    inputMode="tel"
                    autoFocus
                    value={v.other}
                    placeholder="8 7XX XXX XX XX"
                    onChange={(e) => set({ other: e.target.value })}
                  />
                  {v.other && !phone && (
                    <span className="text-xs text-status-critical">нужен мобильный номер</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                className="btn-primary !px-5 w-full sm:w-auto"
                disabled={busy !== null || !phone || !(amount > 0)}
              >
                {busy === `send-${f.farm}` ? "Отправляю…" : `Выставить счёт · ${money(amount || 0)}`}
              </button>
              {v.editAmount ? (
                <label className="flex items-center gap-2 text-sm text-ink-secondary">
                  сумма
                  <input
                    className="input !w-28 !py-1.5 tabular-nums text-right"
                    inputMode="numeric"
                    value={v.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                  />
                  <span className="text-xs text-ink-muted">из {money(f.due)}</span>
                </label>
              ) : (
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  onClick={() => set({ editAmount: true, amount: String(f.due) })}
                >
                  выставить часть
                </button>
              )}
            </div>
          </form>
        );
      })}

      {data.invoices.length > 0 && <History invoices={data.invoices} farms={data.farms} />}

      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
      {note && <p className="text-sm text-status-good">{note}</p>}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm min-h-[44px] sm:min-h-0 transition-colors",
        active
          ? "border-accent bg-accent-soft text-ink-primary ring-1 ring-accent"
          : "border-line-hairline bg-surface text-ink-secondary hover:border-line-strong"
      )}
    >
      <span
        className={clsx(
          "w-3.5 h-3.5 rounded-full border flex-none",
          active ? "border-accent bg-accent shadow-[inset_0_0_0_2px_#fff]" : "border-line-strong"
        )}
      />
      {children}
    </button>
  );
}

const STEPS = ["Выставлен", "У клиента", "Оплачен"];

/** Где сейчас счёт: полоска из трёх шагов, время и две кнопки. */
function Tracker({
  inv,
  busy,
  onRefresh,
  onCancel,
}: {
  inv: KaspiInvoice;
  busy: string | null;
  onRefresh?: () => void;
  onCancel?: () => void;
}) {
  const step = kaspiTrackerStep(inv.status);
  const paid = step === 3;
  const text =
    inv.status === "processing"
      ? "Счёт уходит в Kaspi…"
      : inv.status === "pending"
        ? `Клиенту пришёл счёт · ждём оплату ${waitingWords(inv.createdAt)}`
        : inv.status === "cancelling"
          ? "Счёт отменяется…"
          : paid
            ? `Оплачен ${formatMoment(inv.paidAt || inv.updatedAt)}${
                inv.paymentId && !inv.paymentId.startsWith("claim-") ? " · платёж проведён" : " · проводится…"
              }`
            : kaspiStatusLabel(inv.status);

  return (
    <div className={clsx("rounded-lg p-3 space-y-3 border", paid ? "bg-status-good/10 border-status-good/20" : "bg-surface border-kaspi/15")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-semibold tabular-nums">{money(inv.amount)}</span>
        <span className="text-sm text-ink-secondary tabular-nums">на {prettyKaspiPhone(inv.phone)}</span>
        {inv.sandbox && <span className="text-xs text-[#8a5a00]">тест</span>}
        <span className="text-xs text-ink-muted ml-auto">
          №{inv.invoiceId} · {formatMoment(inv.createdAt)}
        </span>
      </div>

      <ol className="grid grid-cols-3 gap-1" aria-label="Где сейчас счёт">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step >= n;
          const current = step === n && !paid;
          return (
            <li key={label} className="space-y-1">
              <div
                className={clsx(
                  "h-1.5 rounded-full",
                  done ? (paid ? "bg-status-good" : "bg-accent") : "bg-line-hairline",
                  current && "animate-pulse"
                )}
              />
              <div className={clsx("text-[11px]", done ? "text-ink-primary font-medium" : "text-ink-muted")}>
                {label}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={clsx("text-sm", paid ? "text-status-good font-medium" : "text-ink-secondary")}>{text}</span>
        {onRefresh && (
          <span className="ml-auto flex gap-4 text-sm">
            <button
              type="button"
              className="text-accent hover:underline disabled:opacity-50"
              disabled={busy !== null}
              onClick={onRefresh}
            >
              {busy === `refresh-${inv.invoiceId}` ? "Проверяю…" : "Проверить"}
            </button>
            {inv.status !== "cancelling" && onCancel && (
              <button
                type="button"
                className="text-status-critical hover:underline disabled:opacity-50"
                disabled={busy !== null}
                onClick={onCancel}
              >
                Отменить
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Все счета по заявке — свёрнуто: нужно, когда разбираются, а не каждый день. */
function History({ invoices, farms }: { invoices: KaspiInvoice[]; farms: KaspiPanelData["farms"] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none text-ink-secondary">Все счета Kaspi ({invoices.length})</summary>
      <ul className="mt-2 divide-y divide-line-hairline/70">
        {invoices.map((i) => (
          <li key={i.invoiceId} className="py-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="tabular-nums font-medium">{money(i.amount)}</span>
            <span
              className={clsx(
                "text-xs rounded-full px-2 py-0.5",
                isPaidKaspiStatus(i.status)
                  ? "bg-status-good/15 text-status-good"
                  : i.status === "error"
                    ? "bg-status-critical/10 text-status-critical"
                    : isOpenKaspiStatus(i.status)
                      ? "bg-status-warning/15 text-[#8a5a00]"
                      : "bg-surface-sunk text-ink-muted"
              )}
            >
              {kaspiStatusLabel(i.status)}
            </span>
            <span className="text-xs text-ink-muted">
              {prettyKaspiPhone(i.phone)} · {formatMoment(i.createdAt)}
              {farms.length > 1 && ` · ${farms.find((f) => f.farm === i.farm)?.label ?? i.farm}`}
            </span>
            {i.status === "error" && (
              <span className="text-xs text-status-critical w-full">{kaspiErrorText(i.errorCode, i.errorMessage)}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
