"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { recalculateOrderAction, rejectClaimAction } from "@/app/finance/actions";
import { CLAIM_STATUSES, CLAIM_STATUS_LABELS } from "@/lib/constants";
import { parseNumber } from "./NumberCell";
import MoreToggle from "./MoreToggle";
import { money } from "./PaymentPanel";

/** Что бухгалтеру нужно знать о рекламации, чтобы решить прямо здесь. */
export interface ClaimView {
  claimId: string;
  createdAt: string;
  orderId: string;
  managerName: string;
  reason: string;
  comment: string;
  status: string;
  decidedAt: string;
  accountantEmail: string;
  decision: string;
  clientName: string;
  orderTotal: number;
  paidAmount: number;
  items: {
    itemId: string;
    label: string;
    quantity: number;
    shippedQuantity: number;
    unitPrice: number;
  }[];
}

const VISIBLE_DONE = 5;

/**
 * Рекламации у бухгалтера.
 *
 * Решение — это пересчёт заявки, поэтому форма пересчёта живёт прямо в строке
 * рекламации: уходить на страницу заявки, править там и возвращаться отмечать
 * — три места вместо одного, и на третьем шаге про рекламацию забывают.
 *
 * Отгруженное количество показано рядом и НЕ меняется: цветок со склада уехал,
 * и подчищать историю склада ради счёта нельзя. Меняется то, за что клиент
 * платит.
 */
export default function ClaimsBoard({
  claims,
  canDecide,
}: {
  claims: ClaimView[];
  canDecide: boolean;
}) {
  const open = claims.filter((c) => c.status === CLAIM_STATUSES.NEW);
  const done = claims.filter((c) => c.status !== CLAIM_STATUSES.NEW);
  const [expandedDone, setExpandedDone] = useState(false);
  const shownDone = expandedDone ? done : done.slice(0, VISIBLE_DONE);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="font-medium">
          Ждут решения{open.length > 0 && <span className="text-ink-muted"> · {open.length}</span>}
        </h2>
        {open.length === 0 ? (
          <div className="card text-center py-10">
            <div className="text-2xl mb-2">✓</div>
            <p className="font-medium">Нерешённых рекламаций нет</p>
            <p className="text-sm text-ink-secondary mt-1">
              Менеджеры не сообщали о проблемах по заявкам.
            </p>
          </div>
        ) : (
          open.map((claim) => (
            <OpenClaim key={claim.claimId} claim={claim} canDecide={canDecide} />
          ))
        )}
      </div>

      {done.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-medium">Решённые</h2>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-3 font-medium">Когда</th>
                  <th className="px-4 py-3 font-medium">Клиент</th>
                  <th className="px-4 py-3 font-medium">Причина</th>
                  <th className="px-4 py-3 font-medium">Решение</th>
                  <th className="px-4 py-3 font-medium">Итог</th>
                </tr>
              </thead>
              <tbody>
                {shownDone.map((c) => (
                  <tr key={c.claimId} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                      {new Date(c.decidedAt || c.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/orders/${c.orderId}`} className="font-medium hover:underline">
                        {c.clientName}
                      </Link>
                      <span className="block text-xs text-ink-muted">{c.managerName}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.reason}
                      <span className="block text-xs text-ink-muted">{c.comment}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={clsx(
                          "font-medium",
                          c.status === CLAIM_STATUSES.ACCEPTED
                            ? "text-status-good"
                            : "text-ink-secondary"
                        )}
                      >
                        {CLAIM_STATUS_LABELS[c.status] ?? c.status}
                      </span>
                      {c.decision && (
                        <span className="block text-xs text-ink-muted">{c.decision}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                      {money(c.orderTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreToggle
            expanded={expandedDone}
            hidden={done.length - shownDone.length}
            onToggle={() => setExpandedDone((v) => !v)}
            what="рекламаций"
          />
        </div>
      )}
    </div>
  );
}

function OpenClaim({ claim, canDecide }: { claim: ClaimView; canDecide: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "recalc" | "reject">("none");
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      claim.items.map((i) => [i.itemId, { quantity: i.quantity, unitPrice: i.unitPrice }])
    )
  );
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const newTotal = claim.items.reduce(
    (s, i) => s + (values[i.itemId]?.quantity ?? 0) * (values[i.itemId]?.unitPrice ?? 0),
    0
  );
  const diff = newTotal - claim.orderTotal;
  const overpaid = Math.max(0, claim.paidAmount - newTotal);

  function submitRecalc() {
    setError(null);
    startTransition(async () => {
      try {
        await recalculateOrderAction(
          claim.orderId,
          claim.items.map((i) => ({
            itemId: i.itemId,
            quantity: values[i.itemId]?.quantity ?? i.quantity,
            unitPrice: values[i.itemId]?.unitPrice ?? i.unitPrice,
          })),
          reason || `${claim.reason}: ${claim.comment}`,
          claim.claimId
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось пересчитать");
      }
    });
  }

  function submitReject() {
    setError(null);
    startTransition(async () => {
      try {
        await rejectClaimAction(claim.claimId, reason);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отклонить");
      }
    });
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {claim.reason} ·{" "}
            <Link href={`/orders/${claim.orderId}`} className="hover:underline">
              {claim.clientName}
            </Link>
          </h3>
          <p className="text-sm text-ink-secondary mt-0.5">{claim.comment}</p>
          <p className="text-xs text-ink-muted mt-1">
            Подал {claim.managerName} · {new Date(claim.createdAt).toLocaleString("ru-RU")} · счёт{" "}
            {money(claim.orderTotal)}
            {claim.paidAmount > 0 && ` · получено ${money(claim.paidAmount)}`}
          </p>
        </div>
        {canDecide && mode === "none" && (
          <div className="flex gap-2">
            <button onClick={() => setMode("recalc")} className="btn-primary !py-1.5">
              Пересчитать заявку
            </button>
            <button onClick={() => setMode("reject")} className="btn-secondary !py-1.5">
              Отклонить
            </button>
          </div>
        )}
      </div>

      {mode === "recalc" && (
        <div className="space-y-3 border-t border-line-hairline pt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-2 py-2 font-medium">Позиция</th>
                  <th className="px-2 py-2 font-medium text-right">Отгружено</th>
                  <th className="px-2 py-2 font-medium text-right">К оплате, шт</th>
                  <th className="px-2 py-2 font-medium text-right">Цена, ₸</th>
                  <th className="px-2 py-2 font-medium text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {claim.items.map((i) => {
                  const v = values[i.itemId] ?? { quantity: i.quantity, unitPrice: i.unitPrice };
                  const changed = v.quantity !== i.quantity || v.unitPrice !== i.unitPrice;
                  return (
                    <tr key={i.itemId} className="border-b border-line-hairline last:border-0">
                      <td className="px-2 py-2">{i.label}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                        {i.shippedQuantity}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          className={clsx(
                            "input !w-24 !py-1 !min-h-0 text-right tabular-nums",
                            changed && "border-accent"
                          )}
                          inputMode="numeric"
                          value={v.quantity ? v.quantity.toLocaleString("ru-RU") : "0"}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [i.itemId]: { ...v, quantity: parseNumber(e.target.value) },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          className={clsx(
                            "input !w-24 !py-1 !min-h-0 text-right tabular-nums",
                            changed && "border-accent"
                          )}
                          inputMode="decimal"
                          value={v.unitPrice ? v.unitPrice.toLocaleString("ru-RU") : "0"}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [i.itemId]: { ...v, unitPrice: parseNumber(e.target.value) },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                        {money(v.quantity * v.unitPrice)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-right text-ink-secondary">
                    Станет вместо {money(claim.orderTotal)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                    {money(newTotal)}
                    {diff !== 0 && (
                      <span
                        className={clsx(
                          "block text-xs font-normal",
                          diff < 0 ? "text-status-critical" : "text-status-good"
                        )}
                      >
                        {diff < 0 ? "−" : "+"}
                        {money(Math.abs(diff))}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {overpaid > 0 && (
            <div className="text-sm text-[#8a5a00] bg-[#8a5a00]/10 rounded-lg px-3 py-2">
              После пересчёта по заявке будет переплата {money(overpaid)} — эти деньги придётся
              вернуть клиенту или зачесть в следующую заявку.
            </div>
          )}

          <label className="block text-sm">
            <span className="block text-ink-secondary mb-1">Почему пересчитываем</span>
            <input
              className="input"
              placeholder={`${claim.reason}: ${claim.comment}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div className="flex gap-2">
            <button onClick={submitRecalc} disabled={pending} className="btn-primary disabled:opacity-50">
              {pending ? "Сохраняю…" : "Пересчитать и провести рекламацию"}
            </button>
            <button onClick={() => setMode("none")} disabled={pending} className="btn-secondary">
              Отмена
            </button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="space-y-3 border-t border-line-hairline pt-3">
          <label className="block text-sm">
            <span className="block text-ink-secondary mb-1">
              Почему отклоняем — менеджер это увидит
            </span>
            <input
              className="input"
              placeholder="Например: цветок приняли без замечаний, претензия через неделю"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button onClick={submitReject} disabled={pending} className="btn-primary disabled:opacity-50">
              {pending ? "Сохраняю…" : "Отклонить рекламацию"}
            </button>
            <button onClick={() => setMode("none")} disabled={pending} className="btn-secondary">
              Отмена
            </button>
          </div>
        </div>
      )}

      {!canDecide && (
        <p className="text-xs text-ink-muted border-t border-line-hairline pt-3">
          Решение по рекламации принимает бухгалтер.
        </p>
      )}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
