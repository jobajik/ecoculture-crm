"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { OrderWithItems } from "@/lib/types";
import type { OrderStage } from "@/lib/orderStage";
import type { PayState } from "@/lib/orderPay";
import { orderCode } from "@/lib/paymentStage";
import { formatDay } from "@/lib/formatDate";
import { formatGrade } from "@/lib/constants";
import { confirmRefusal } from "@/lib/orderRules";
import { canEditOrder } from "@/lib/orderEdit";
import { canRepeatFrom, newClientOrderHref } from "@/lib/repeatOrder";
import { hasNoClientInvoice } from "@/lib/orderKind";
import { whatsappLink } from "@/lib/leads";
import { setManagerConfirmedAction } from "@/app/finance/actions";
import { unwrap } from "@/lib/actionResult";
import Pill from "./Pill";
import Icon from "./Icon";

/**
 * Карточка заявки СБОКУ от списка (19.10.2026, макет принят владельцем: «открыл заявку из списка — она открывается
 * сбоку, а не уводит на другую страницу; сохранил — остался там же»). Показывает то, ради чего заявку открывают из
 * списка: кто сейчас должен сделать ход (лестница этапов), позиции, деньги и главную кнопку. Всё остальное — на
 * полной странице заявки, ссылка внизу.
 *
 * На широком экране — колонка справа от таблицы, на телефоне — панель поверх списка. Данные те же, что в строке
 * списка (ничего не дочитывается): этап и деньги уже посчитаны сервером.
 */
export default function OrderDrawer({
  order,
  stage,
  pay,
  managerName,
  today,
  viewerRole,
  viewerEmail,
  onClose,
}: {
  order: OrderWithItems;
  stage: OrderStage;
  pay?: PayState;
  managerName: string;
  today: string;
  viewerRole: string;
  viewerEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc закрывает; при смене заявки ошибка прошлой не тянется за новой.
  useEffect(() => {
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [order.orderId, onClose]);

  const noInvoice = hasNoClientInvoice(order);
  const cancelled = stage.key === "cancelled";
  // Лестница: согласована → деньги (если счёт есть) → к сборке → отгружена. Кто делает ход — из этапа.
  const steps: { label: string; who: string }[] = [
    { label: "Согласована с клиентом", who: order.managerConfirmed ? formatDay(order.managerConfirmedAt).slice(0, 5) || "есть" : stage.key === "wait_confirm" ? stage.actor : "" },
    ...(noInvoice ? [] : [{ label: "Деньги пришли", who: pay?.label?.toLowerCase() || "" }]),
    { label: "Готова к сборке", who: "склад" },
    { label: "Отгружена", who: "" },
  ];
  const current = cancelled
    ? -1
    : stage.key === "wait_confirm"
      ? 0
      : stage.key === "wait_money"
        ? 1
        : stage.key === "ready" || stage.key === "partly"
          ? steps.length - 2
          : steps.length - 1;
  const done = stage.key === "shipped" ? steps.length : current;

  const canConfirm = !order.managerConfirmed && confirmRefusal(order, viewerRole, viewerEmail, true) === "";
  const canEdit = canEditOrder(order, viewerRole, viewerEmail);
  const canRepeat = canRepeatFrom(order, viewerRole, viewerEmail);
  const wa = whatsappLink(order.clientPhone);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await setManagerConfirmedAction(order.orderId, true));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подтвердить");
    } finally {
      setBusy(false);
    }
  };

  const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

  return (
    <aside
      aria-label={`Заявка ${orderCode(order.orderId)}`}
      className="card !p-0 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] xl:max-h-[calc(100vh-7rem)] xl:sticky xl:top-[88px]"
    >
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line-hairline">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-muted">
            Заявка · {formatDay(order.createdAt)} · {managerName}
            {order.store === "office" && <span className="text-section-stock font-medium"> · офис</span>}
          </div>
          <div className="font-display font-extrabold text-[24px] leading-tight text-accent">№ {orderCode(order.orderId)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            {order.clientId ? (
              <Link href={`/clients/${order.clientId}`} className="font-semibold text-[15px] hover:text-accent truncate">
                {order.clientName || "—"}
              </Link>
            ) : (
              <span className="font-semibold text-[15px] truncate">{order.clientName || "—"}</span>
            )}
            <span className="text-sm text-ink-secondary">
              · {order.deliveryDate ? (order.deliveryDate === today ? "сегодня" : formatDay(order.deliveryDate)) : "без даты"}
            </span>
            {stage.lateDays > 0 && <Pill tone="bad">опаздывает {stage.lateDays} дн.</Pill>}
            {cancelled && <Pill tone="muted">отменена</Pill>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть карточку"
          className="w-8 h-8 rounded-lg border border-line-hairline grid place-items-center text-ink-secondary hover:bg-surface-plane text-lg leading-none flex-none"
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto min-h-0">
        {!cancelled && (
          <div className="px-5 py-3 border-b border-line-hairline space-y-2">
            {steps.map((s, i) => {
              const state = i < done ? "done" : i === current ? "cur" : "todo";
              return (
                <div key={s.label} className="flex items-center gap-2.5 text-[13px]">
                  <span
                    className={clsx(
                      "w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] font-bold flex-none",
                      state === "done" && "bg-accent text-white",
                      state === "cur" && "bg-status-warning/15 text-[#8a5a00] ring-2 ring-status-warning",
                      state === "todo" && "bg-surface-sunk text-ink-muted"
                    )}
                  >
                    {state === "done" ? <Icon name="check" className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className={clsx("flex-1", state === "cur" && "font-semibold")}>{s.label}</span>
                  <span className="text-xs text-ink-muted">{state === "cur" && stage.next ? stage.actor : s.who}</span>
                </div>
              );
            })}
            {stage.next && <div className="text-xs text-ink-secondary pt-1">{stage.next}</div>}
          </div>
        )}

        <div className="px-5 py-3 border-b border-line-hairline">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted mb-1">Позиции · {order.items.length}</div>
          {order.items.map((i) => (
            <div key={i.itemId} className="flex justify-between gap-3 py-1.5 border-t border-line-hairline first:border-t-0 text-[13px]">
              <span className="min-w-0 truncate">
                {i.variety}, {formatGrade(i.grade)}
              </span>
              <span className="whitespace-nowrap">
                <b>{i.quantity.toLocaleString("ru-RU")}</b>
                {i.shippedQuantity > 0 && <span className="text-ink-muted"> (отгр. {i.shippedQuantity.toLocaleString("ru-RU")})</span>}
                {i.unitPrice > 0 && <span className="text-ink-muted"> × {i.unitPrice.toLocaleString("ru-RU")}</span>}
              </span>
            </div>
          ))}
          {order.notes && <div className="text-xs text-ink-secondary mt-2 whitespace-pre-line">{order.notes}</div>}
        </div>

        <div className="px-5 py-3 border-b border-line-hairline grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-surface-plane px-3 py-2">
            <div className="text-[11px] text-ink-muted">Сумма</div>
            <div className="font-display font-extrabold text-[15px]">{noInvoice ? "—" : money(order.totalAmount)}</div>
          </div>
          <div className="rounded-xl bg-surface-plane px-3 py-2">
            <div className="text-[11px] text-ink-muted">Оплачено</div>
            <div className="font-display font-extrabold text-[15px]">{pay?.sale ? money(pay.paid) : "—"}</div>
          </div>
          <div className="rounded-xl bg-surface-plane px-3 py-2">
            <div className="text-[11px] text-ink-muted">Долг</div>
            <div className={clsx("font-display font-extrabold text-[15px]", pay?.late && "text-status-critical")}>
              {pay?.sale && pay.debt > 0 ? money(pay.debt) : "—"}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-wrap gap-2">
          {canConfirm && (
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              {busy ? "Подтверждаю…" : "Подтвердить — согласовано с клиентом"}
            </button>
          )}
          {!order.deliveryDate && !cancelled && canEdit && (
            <Link href={`/orders/${order.orderId}/edit`} className="btn-secondary">
              Указать дату доставки
            </Link>
          )}
          {canEdit && order.deliveryDate && (
            <Link href={`/orders/${order.orderId}/edit`} className="btn-secondary">
              Изменить
            </Link>
          )}
          {canRepeat && (
            <Link href={newClientOrderHref(viewerRole, order.clientId, order.orderId)} className="btn-secondary">
              Повторить
            </Link>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary">
              WhatsApp клиенту
            </a>
          )}
          <Link href={`/orders/${order.orderId}`} className="ml-auto self-center text-[13px] font-semibold text-accent hover:text-accent-hover">
            Вся страница заявки →
          </Link>
          {error && <div className="w-full text-xs text-status-critical">{error}</div>}
        </div>
      </div>
    </aside>
  );
}
