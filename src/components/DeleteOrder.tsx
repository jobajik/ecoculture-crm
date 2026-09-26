"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { deleteOrderAction, orderDeleteInfoAction } from "@/app/orders/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import type { StockChoice } from "@/lib/orderDelete";

/**
 * Удаление заявки совсем — только администратор, и любую (решение владельца).
 *
 * Возврата нет: в Google-таблице нет корзины. Поэтому окно говорит ДО нажатия,
 * что уйдёт вместе с заявкой (деньги из выручки, платежи, рекламации), а если
 * была отгрузка — спрашивает, вернуть ли стебли на склад. Причина обязательна:
 * она уйдёт в журнал и останется единственным следом.
 *
 * `inline` — окно в строке списка заявок; после удаления список просто
 * обновляется. Со страницы заявки уходим в список: страница удалённой заявки
 * показала бы «не найдено», и это читалось бы как поломка.
 */
export default function DeleteOrder({
  orderId,
  paidAmount = 0,
  payments = 0,
  claims = 0,
  shippedStems = 0,
  inline = false,
  onClose,
}: {
  orderId: string;
  paidAmount?: number;
  payments?: number;
  claims?: number;
  shippedStems?: number;
  inline?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(inline);
  const [reason, setReason] = useState("");
  const [stock, setStock] = useState<StockChoice | "">("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // В списке заявок отгрузки и платежи не читаются — окно спрашивает сервер
  // само, когда его открыли: про склад надо спросить ДО нажатия.
  const [info, setInfo] = useState<{ paidAmount: number; payments: number; claims: number; shippedStems: number; openKaspi: number } | null>(null);
  const [loading, setLoading] = useState(inline);
  useEffect(() => {
    if (!inline) return;
    let alive = true;
    orderDeleteInfoAction(orderId)
      .then((r) => {
        if (alive) setInfo(unwrapValue(r));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Не удалось проверить заявку");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [inline, orderId]);
  const facts = info ?? { paidAmount, payments, claims, shippedStems };
  const needStock = facts.shippedStems > 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await deleteOrderAction(orderId, reason, stock));
        if (inline) {
          onClose?.();
          router.refresh();
        } else {
          router.push("/orders");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось удалить заявку");
      }
    });
  }

  function close() {
    setError(null);
    if (inline) onClose?.();
    else setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-ink-muted hover:text-status-critical">
        Удалить заявку насовсем
      </button>
    );
  }

  const money = Math.round(facts.paidAmount).toLocaleString("ru-RU");
  return (
    <div className={clsx("card space-y-3 border-status-critical/40 text-left", inline && "!shadow-lg")}>
      <div>
        <h2 className="font-medium text-status-critical">Удалить заявку {inline ? orderId : ""} насовсем</h2>
        <p className="text-sm text-ink-secondary mt-0.5">
          <b>Вернуть будет нельзя.</b> Если клиент просто отказался — лучше <b>отменить</b>.
        </p>
      </div>
      {loading && <div className="text-sm text-ink-muted">Проверяю, что по заявке уже было…</div>}
      {info && info.openKaspi > 0 && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          По заявке висит Kaspi-счёт — сначала отмените его в панели оплаты.
        </div>
      )}
      {(facts.paidAmount > 0 || facts.claims > 0 || needStock) && (
        <ul className="text-sm space-y-0.5 rounded-lg bg-status-critical/5 px-3 py-2">
          {facts.paidAmount > 0 && (
            <li>
              Из выручки уйдёт <b>{money} ₸</b>
              {facts.payments > 0 && ` — удалятся платежи: ${facts.payments}`}
            </li>
          )}
          {facts.claims > 0 && <li>Удалятся рекламации: {facts.claims}</li>}
          {needStock && <li>По заявке отгружено {facts.shippedStems.toLocaleString("ru-RU")} шт.</li>}
        </ul>
      )}
      {needStock && (
        <div className="space-y-1.5 text-sm">
          <div className="text-xs text-ink-muted">Что со стеблями?</div>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={stock === "return"} onChange={() => setStock("return")} />
            <span>
              <b>Вернуть на склад</b> — заявка была ошибочной, цветок никуда не ехал
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={stock === "keep"} onChange={() => setStock("keep")} />
            <span>
              <b>Цветок уехал</b> — склад не трогать, отгрузка останется в журнале
            </span>
          </label>
        </div>
      )}
      <input className="input" placeholder="Причина удаления" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={submit}
          disabled={pending || loading || !reason.trim() || (needStock && !stock)}
          className="btn-primary !bg-status-critical disabled:opacity-50"
        >
          {pending ? "Удаляю…" : "Удалить навсегда"}
        </button>
        <button onClick={close} disabled={pending} className="btn-secondary">
          Не удалять
        </button>
      </div>
    </div>
  );
}
