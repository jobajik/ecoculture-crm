"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { recalculateOrderAction, rejectClaimAction } from "@/app/finance/actions";
import { CLAIM_STATUSES, CLAIM_STATUS_LABELS } from "@/lib/constants";
import { parseNumber } from "./NumberCell";
import Pager, { pageSlice } from "./Pager";
import Chips from "./Chips";
import Pill from "./Pill";
import StatTile from "./StatTile";
import { money } from "./PaymentPanel";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { unwrap } from "@/lib/actionResult";

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

/** Нерешённые — карточками с формой, поэтому порция меньше. */
const OPEN_PAGE = 4;

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
 *
 * Вид (19.10.2026): плитки сверху, одна карточка с вкладками «Ждут решения» / «Решённые», листание страницами.
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
  const accepted = done.filter((c) => c.status === CLAIM_STATUSES.ACCEPTED);
  const rejected = done.filter((c) => c.status === CLAIM_STATUSES.REJECTED);
  const [tab, setTab] = useState<"open" | "done">(open.length > 0 || done.length === 0 ? "open" : "done");
  const [doneFilter, setDoneFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tab, doneFilter, search]);

  const q = search.trim().toLowerCase();
  const matches = (c: ClaimView) =>
    !q || [c.clientName, c.managerName, c.reason, c.comment, c.decision].some((v) => v.toLowerCase().includes(q));
  const openRows = open.filter(matches);
  const doneRows = done
    .filter((c) => doneFilter === "all" || c.status === doneFilter)
    .filter(matches);
  const tabBtn = (on: boolean) =>
    clsx(
      "px-4 py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
      on ? "border-section-money text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
    );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          label="Ждут решения"
          value={String(open.length)}
          sub={open.length ? money(open.reduce((s, c) => s + c.orderTotal, 0)) + " в заявках" : "нерешённых нет"}
          tone={open.length ? "warning" : "good"}
        />
        <StatTile label="Проведено" value={String(accepted.length)} sub="заявка пересчитана" />
        <StatTile label="Отклонено" value={String(rejected.length)} sub="с объяснением менеджеру" />
        <StatTile label="Всего" value={String(claims.length)} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex gap-1 px-2 border-b border-line-hairline overflow-x-auto scroll-x-hidden">
          <button type="button" className={tabBtn(tab === "open")} onClick={() => setTab("open")}>
            Ждут решения ({open.length})
          </button>
          <button type="button" className={tabBtn(tab === "done")} onClick={() => setTab("done")}>
            Решённые ({done.length})
          </button>
        </div>

        <div className="px-4 py-3 border-b border-line-hairline flex flex-col lg:flex-row lg:items-center gap-2">
          {tab === "done" ? (
            <Chips
              className="min-w-0 flex-1"
              value={doneFilter}
              onChange={setDoneFilter}
              items={[
                { value: "all", label: "Все", count: done.length },
                { value: CLAIM_STATUSES.ACCEPTED, label: "Проведены", count: accepted.length },
                { value: CLAIM_STATUSES.REJECTED, label: "Отклонены", count: rejected.length },
              ]}
            />
          ) : (
            <div className="flex-1 text-xs text-ink-muted">
              {canDecide ? "Пересчитать заявку или отклонить — прямо в строке." : "Решает бухгалтер."}
            </div>
          )}
          <input
            className="input !w-full lg:!w-64 flex-none"
            placeholder="Клиент, менеджер, причина"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {tab === "open" ? (
          openRows.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-2xl mb-2">✓</div>
              <p className="font-medium">{q ? "Ничего не нашлось" : "Нерешённых рекламаций нет"}</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-line-hairline">
                {pageSlice(openRows, page, OPEN_PAGE).map((claim) => (
                  <OpenClaim key={claim.claimId} claim={claim} canDecide={canDecide} />
                ))}
              </div>
              <Pager total={openRows.length} page={page} onPage={setPage} size={OPEN_PAGE} what="рекламаций" />
            </>
          )
        ) : doneRows.length === 0 ? (
          <p className="text-sm text-ink-muted px-4 py-6">{q ? "Ничего не нашлось." : "Решённых пока нет."}</p>
        ) : (
          <>
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
                    <th className="px-4 py-2.5 font-medium">Когда</th>
                    <th className="px-4 py-2.5 font-medium">Клиент</th>
                    <th className="px-4 py-2.5 font-medium">Причина</th>
                    <th className="px-4 py-2.5 font-medium">Решение</th>
                    <th className="px-4 py-2.5 font-medium text-right">Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(doneRows, page).map((c) => (
                    <tr key={c.claimId} className="border-b border-line-hairline last:border-0">
                      <td data-label="Когда" className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                        {formatDay(c.decidedAt || c.createdAt)}
                      </td>
                      <td data-label="Клиент" className="px-4 py-2.5">
                        <Link href={`/orders/${c.orderId}`} className="font-medium hover:underline">
                          {c.clientName}
                        </Link>
                        <span className="block text-xs text-ink-muted">{c.managerName}</span>
                      </td>
                      <td data-label="Причина" className="px-4 py-2.5">
                        {c.reason}
                        <span className="block text-xs text-ink-muted">{c.comment}</span>
                      </td>
                      <td data-label="Решение" className="px-4 py-2.5">
                        <Pill tone={c.status === CLAIM_STATUSES.ACCEPTED ? "good" : "muted"}>
                          {CLAIM_STATUS_LABELS[c.status] ?? c.status}
                        </Pill>
                        {c.decision && <span className="block text-xs text-ink-muted mt-0.5">{c.decision}</span>}
                      </td>
                      <td data-label="Итог" className="px-4 py-2.5 tabular-nums whitespace-nowrap text-right">
                        {money(c.orderTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager total={doneRows.length} page={page} onPage={setPage} what="рекламаций" />
          </>
        )}
      </div>
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
        unwrap(await recalculateOrderAction(
          claim.orderId,
          claim.items.map((i) => ({
            itemId: i.itemId,
            quantity: values[i.itemId]?.quantity ?? i.quantity,
            unitPrice: values[i.itemId]?.unitPrice ?? i.unitPrice,
          })),
          reason || `${claim.reason}: ${claim.comment}`,
          claim.claimId
        ));
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
        unwrap(await rejectClaimAction(claim.claimId, reason));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отклонить");
      }
    });
  }

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">
            {claim.reason} ·{" "}
            <Link href={`/orders/${claim.orderId}`} className="hover:underline">
              {claim.clientName}
            </Link>
          </h3>
          <p className="text-sm text-ink-secondary mt-0.5">{claim.comment}</p>
          <p className="text-xs text-ink-muted mt-1">
            Подал {claim.managerName} · {formatMoment(claim.createdAt)} · счёт{" "}
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
          <div className="table-scroll table-cards">
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
                      <td data-label="Позиция" className="px-2 py-2">{i.label}</td>
                      <td data-label="Отгружено" className="px-2 py-2 text-right tabular-nums text-ink-muted">
                        {i.shippedQuantity}
                      </td>
                      <td data-label="К оплате, шт" className="px-2 py-2 text-right">
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
                      <td data-label="Цена, ₸" className="px-2 py-2 text-right">
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
                      <td data-label="Сумма" className="px-2 py-2 text-right tabular-nums font-medium whitespace-nowrap">
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
              Будет переплата {money(overpaid)} — вернуть клиенту или зачесть.
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
              {pending ? "Сохраняю…" : "Пересчитать и провести"}
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
              placeholder="например, приняли без замечаний"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button onClick={submitReject} disabled={pending} className="btn-primary disabled:opacity-50">
              {pending ? "Сохраняю…" : "Отклонить"}
            </button>
            <button onClick={() => setMode("none")} disabled={pending} className="btn-secondary">
              Отмена
            </button>
          </div>
        </div>
      )}

      {!canDecide && (
        <p className="text-xs text-ink-muted border-t border-line-hairline pt-3">
          Решает бухгалтер.
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
