"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrderAction } from "@/app/orders/actions";

/**
 * Удаление заявки совсем — кнопка только у администратора.
 *
 * Отличается от отмены тем, что возврата нет: в Google-таблице нет корзины, и
 * строка исчезает навсегда. Поэтому форма устроена строже обычной:
 *
 * - она закрыта под неприметной ссылкой, а не кнопкой рядом с отменой;
 * - требует причину — она уйдёт в журнал и останется единственным следом;
 * - прямо говорит, что заявка исчезнет, и предлагает отмену как обычный путь.
 *
 * После удаления открывать нечего, поэтому уходим в список заявок: страница
 * удалённой заявки показала бы «не найдено», и это читалось бы как поломка.
 */
export default function DeleteOrder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteOrderAction(orderId, reason);
        router.push("/orders");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось удалить заявку");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-ink-muted hover:text-status-critical"
      >
        Удалить заявку насовсем
      </button>
    );
  }

  return (
    <div className="card space-y-3 border-status-critical/40">
      <div>
        <h2 className="font-medium text-status-critical">Удалить заявку насовсем</h2>
        <p className="text-sm text-ink-secondary mt-0.5">
          Заявка и её позиции исчезнут из базы. <b>Вернуть их будет нельзя</b> — корзины в
          таблице нет. В журнале останется запись: кто, когда, какая была заявка и почему её
          убрали.
        </p>
        <p className="text-sm text-ink-secondary mt-2">
          Если клиент просто отказался — не удаляйте, а <b>отмените</b>: тогда заявка выйдет из
          выручки и планов, но останется видна, и через месяц будет понятно, что произошло.
        </p>
      </div>
      <input
        className="input"
        placeholder="Почему удаляем — например: завели дважды, тестовая заявка"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={submit}
          disabled={pending || !reason.trim()}
          className="btn-primary !bg-status-critical disabled:opacity-50"
        >
          {pending ? "Удаляю…" : "Удалить навсегда"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="btn-secondary"
        >
          Не удалять
        </button>
      </div>
    </div>
  );
}
