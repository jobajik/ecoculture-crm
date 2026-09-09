"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOrderAction } from "@/app/orders/actions";

/**
 * Отмена заявки.
 *
 * Клиент отказался — обычное дело, и до сих пор системе было нечего на это
 * ответить: кнопки не было вообще, а неотменённая заявка вечно висела в листе
 * сборки, в долгах, в списке звонков и в плане менеджера. Отменять приходилось
 * правкой Google-таблицы руками, то есть в обход всех проверок.
 *
 * Форма закрыта под кнопкой и требует причину: отмена вычёркивает из выручки
 * целую заявку, и через месяц «почему сентябрь просел» разбирают по этой самой
 * строке в журнале.
 */
export default function CancelOrder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await cancelOrderAction(orderId, reason);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отменить заявку");
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-ink-muted hover:text-status-critical">
        Отменить заявку
      </button>
    );
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-medium">Отменить заявку</h2>
        <p className="text-sm text-ink-secondary mt-0.5">
          Заявка исчезнет из листа сборки, из долгов и из продаж менеджера. Вернуть её будет
          нельзя — придётся оформлять заново.
        </p>
      </div>
      <input
        className="input"
        placeholder="Почему отменяем — например: клиент отказался, везёт другой поставщик"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending || !reason.trim()}
          className="btn-primary !bg-status-critical disabled:opacity-50"
        >
          {pending ? "Отменяю…" : "Да, отменить"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-secondary">
          Не отменять
        </button>
      </div>
    </div>
  );
}
