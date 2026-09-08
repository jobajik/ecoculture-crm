"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createClaimAction } from "@/app/finance/actions";
import { CLAIM_REASONS, CLAIM_STATUSES, CLAIM_STATUS_LABELS } from "@/lib/constants";

export interface OrderClaimRow {
  claimId: string;
  createdAt: string;
  reason: string;
  comment: string;
  status: string;
  decidedAt: string;
  decision: string;
  managerName: string;
}

/**
 * Рекламация на странице заявки.
 *
 * Клиент жалуется менеджеру — значит и заводить рекламацию должен менеджер, на
 * своей заявке, где перед глазами позиции и суммы. Бухгалтер увидит её у себя
 * в разделе «Оплаты» и решит: пересчитать заявку или отклонить.
 *
 * Форма закрыта под кнопкой: рекламация — редкое событие, и держать её поле
 * раскрытым на каждой заявке значит намекать, что жаловаться нормально.
 */
export default function OrderClaims({
  orderId,
  claims,
  canCreate,
}: {
  orderId: string;
  claims: OrderClaimRow[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(CLAIM_REASONS[0]);
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasOpen = claims.some((c) => c.status === CLAIM_STATUSES.NEW);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createClaimAction(orderId, reason, comment);
        setComment("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отправить рекламацию");
      }
    });
  }

  if (claims.length === 0 && !canCreate) return null;

  return (
    <div className="card mb-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Рекламации</h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            {hasOpen
              ? "Рекламация отправлена бухгалтеру — она пересчитает заявку или объяснит отказ."
              : "Если клиент жалуется на цветок, сообщите — бухгалтер пересчитает заявку."}
          </p>
        </div>
        {canCreate && !hasOpen && (
          <button onClick={() => setOpen((v) => !v)} className="btn-secondary !py-1.5">
            {open ? "Отмена" : "Сообщить о проблеме"}
          </button>
        )}
      </div>

      {open && canCreate && (
        <div className="space-y-3 border-t border-line-hairline pt-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="block text-ink-secondary mb-1">Что случилось</span>
              <select
                className="input !w-auto"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {CLAIM_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm flex-1 min-w-[240px]">
              <span className="block text-ink-secondary mb-1">
                Подробнее — что именно и сколько
              </span>
              <input
                className="input"
                placeholder="Например: из 1000 роз 60 см двести пришли с раскрытым бутоном"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </div>
          <button onClick={submit} disabled={pending} className="btn-primary disabled:opacity-50">
            {pending ? "Отправляю…" : "Отправить бухгалтеру"}
          </button>
          <p className="text-xs text-ink-muted">
            Сумму править не нужно: её пересчитает бухгалтер. Напишите как есть — от этого зависит,
            за сколько стеблей заплатит клиент.
          </p>
        </div>
      )}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {claims.length > 0 && (
        <ul className="space-y-2 border-t border-line-hairline pt-3">
          {claims.map((c) => (
            <li key={c.claimId} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.reason}</span>
                <span
                  className={clsx(
                    "text-xs px-2 py-0.5 rounded-full",
                    c.status === CLAIM_STATUSES.ACCEPTED
                      ? "bg-status-good/15 text-status-good"
                      : c.status === CLAIM_STATUSES.REJECTED
                        ? "bg-surface-plane text-ink-secondary"
                        : "bg-[#8a5a00]/15 text-[#8a5a00]"
                  )}
                >
                  {CLAIM_STATUS_LABELS[c.status] ?? c.status}
                </span>
                <span className="text-xs text-ink-muted">
                  {c.managerName} · {new Date(c.createdAt).toLocaleDateString("ru-RU")}
                </span>
              </div>
              <div className="text-ink-secondary">{c.comment}</div>
              {c.decision && (
                <div className="text-xs text-ink-muted">
                  Ответ бухгалтера: {c.decision}
                  {c.decidedAt && ` · ${new Date(c.decidedAt).toLocaleDateString("ru-RU")}`}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
