"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { acceptTruckAction, cancelTruckOrderAction } from "@/app/region/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import Pill, { type PillTone } from "./Pill";

export interface TruckCard {
  orderId: string;
  code: string;
  /** «На опт — на склад города» / «В наши магазины». */
  kindLabel: string;
  wholesale: boolean;
  stage: string;
  stageLabel: string;
  /** «заказал Арман · 17.11» */
  byLine: string;
  ordered: number;
  shipped: number;
  pending: number;
  accepted: number;
  shortage: number;
  shortageNote: string;
  items: {
    itemId: string;
    name: string;
    /** Сколько просил город; позицию дописал склад — ноль. */
    quantity: number;
    shipped: number;
    pending: number;
    accepted: number | null;
    /** Сколько склад не отгрузит (позиция закрыта). */
    missing: number;
    /** Ответ склада: «нет на складе», «Добавил склад: вместо…». */
    note: string;
    extra: boolean;
  }[];
}

export interface TruckDay {
  day: string;
  /** «Фура 23.11, понедельник» */
  title: string;
  cards: TruckCard[];
}

const TONE: Record<string, PillTone> = { waiting: "muted", loading: "wait", transit: "wait", received: "good", old: "muted", refused: "bad", cancelled: "muted" };
const nf = (n: number) => n.toLocaleString("ru-RU");

/**
 * Заказы на фуру города по дням фуры (17.11.2026, `regionTruck.ts`): что заказано, что склад отгрузил, что принято.
 * Здесь же приёмка («Принять фуру» — сколько приехало по каждой позиции) и отмена заказа, пока склад не начал грузить.
 */
export default function TruckOrdersBoard({
  store,
  days,
  canAccept,
  canCancel,
  canOpen,
}: {
  store: string;
  days: TruckDay[];
  canAccept: boolean;
  canCancel: boolean;
  /** Номер заказа ведёт на страницу заявки (владелец, РОП, зав. складом). */
  canOpen: boolean;
}) {
  if (days.length === 0) return <p className="card text-sm text-ink-secondary">Заказов на фуру пока нет.</p>;
  return (
    <div className="space-y-6">
      {days.map((d) => (
        <section key={d.day}>
          <h2 className="text-sm font-semibold mb-2">{d.title}</h2>
          <div className="space-y-3">
            {d.cards.map((c) => (
              <Card key={c.orderId} store={store} card={c} canAccept={canAccept} canCancel={canCancel} canOpen={canOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Card({ store, card, canAccept, canCancel, canOpen }: { store: string; card: TruckCard; canAccept: boolean; canCancel: boolean; canOpen: boolean }) {
  const router = useRouter();
  const pendingItems = card.items.filter((i) => i.pending > 0);
  const [mode, setMode] = useState<"view" | "accept" | "cancel">("view");
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(pendingItems.map((i) => [i.itemId, String(i.pending)])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const missingTotal = card.items.reduce((s, i) => s + i.missing, 0);
  // Часть заказа уже уехала — у непогруженных позиций так и пишем, иначе прочерк в «Отгружено» читается как «не будет».
  const anyShipped = card.items.some((i) => i.shipped > 0);
  const acceptedNow = pendingItems.reduce((s, i) => s + (Number(got[i.itemId]) || 0), 0);
  const short = card.pending - acceptedNow;

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const res = unwrapValue(
        await acceptTruckAction({
          store,
          orderId: card.orderId,
          lines: pendingItems.map((i) => ({ itemId: i.itemId, shipped: i.pending, accepted: Number(got[i.itemId]) || 0 })),
          note,
        })
      );
      setDone(
        `Принято ${nf(res.accepted)} шт.${res.shortage > 0 ? ` Недостача ${nf(res.shortage)} шт. записана.` : ""}${res.landed ? " Цветок на складе города." : ""}`
      );
      setMode("view");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать приёмку");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      unwrap(await cancelTruckOrderAction(store, card.orderId));
      setDone("Заказ отменён.");
      setMode("view");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить заказ");
    } finally {
      setBusy(false);
    }
  }

  const accepting = mode === "accept";
  return (
    <div className={clsx("card !p-0 overflow-hidden", card.stage === "cancelled" && "opacity-60")}>
      {/* Отменённый самим городом — приглушён; «склад не отгрузил» — нет: это ответ, который городу надо прочитать. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 sm:px-5 py-3 border-b border-line-hairline">
        <span className="font-medium">{card.kindLabel}</span>
        {canOpen ? (
          <Link href={`/orders/${card.orderId}`} className="text-sm text-accent hover:underline tabular-nums">
            № {card.code}
          </Link>
        ) : (
          <span className="text-sm text-ink-muted tabular-nums">№ {card.code}</span>
        )}
        <span className="text-xs text-ink-muted">{card.byLine}</span>
        <span className="ml-auto">
          <Pill tone={TONE[card.stage] ?? "muted"}>{card.stageLabel}</Pill>
        </span>
      </div>

      <div className="table-scroll overflow-x-auto">
        <table className="w-full text-sm sm:table-fixed">
          <colgroup>
            <col />
            <col className={clsx("sm:w-[16%]", accepting && "hidden sm:table-column")} />
            <col className="sm:w-[16%]" />
            <col className="sm:w-[24%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="font-medium px-4 sm:px-5 py-2">Позиция</th>
              <th className={clsx("font-medium px-2 sm:px-3 py-2 text-right", accepting && "hidden sm:table-cell")}>Заказано</th>
              <th className="font-medium px-2 sm:px-3 py-2 text-right">Отгружено</th>
              <th className="font-medium px-4 sm:px-5 py-2 text-right">{accepting ? "Приехало" : "Принято"}</th>
            </tr>
          </thead>
          <tbody>
            {card.items.map((i) => (
              <tr key={i.itemId} className="border-t border-line-hairline">
                <td className="px-4 sm:px-5 py-2">
                  {i.name}
                  {i.missing > 0 && (
                    <div className="text-xs text-status-critical mt-0.5">
                      не будет {nf(i.missing)} шт.{i.note ? ` — ${i.note}` : ""}
                    </div>
                  )}
                  {i.extra && <div className="text-xs text-ink-muted mt-0.5">{i.note || "Добавил склад"}</div>}
                  {!i.extra && i.missing === 0 && i.quantity - i.shipped > 0 && anyShipped && (
                    <div className="text-xs text-ink-muted mt-0.5">склад ещё не погрузил {i.shipped > 0 ? `${nf(i.quantity - i.shipped)} шт.` : "эту позицию"}</div>
                  )}
                </td>
                <td className={clsx("px-2 sm:px-3 py-2 text-right tabular-nums", accepting && "hidden sm:table-cell")}>{i.extra ? "—" : nf(i.quantity)}</td>
                <td className={clsx("px-2 sm:px-3 py-2 text-right tabular-nums", i.shipped < i.quantity && i.shipped > 0 && "text-[#8a5a00]")}>{i.shipped > 0 ? nf(i.shipped) : "—"}</td>
                <td className="px-4 sm:px-5 py-2 text-right tabular-nums">
                  {accepting && i.pending > 0 ? (
                    <span className="inline-flex items-center gap-2 justify-end">
                      <input
                        className="input !w-20 sm:!w-24 text-right"
                        inputMode="numeric"
                        aria-label={`Приехало: ${i.name}`}
                        value={got[i.itemId] ?? ""}
                        onChange={(e) => setGot((p) => ({ ...p, [i.itemId]: e.target.value.replace(/[^\d]/g, "").slice(0, 6) }))}
                      />
                      <span className="hidden sm:inline text-xs text-ink-muted whitespace-nowrap">из {nf(i.pending)}</span>
                    </span>
                  ) : i.pending > 0 ? (
                    <span className="text-[#8a5a00]">ждёт {nf(i.pending)}</span>
                  ) : i.accepted !== null ? (
                    <span className={clsx(i.accepted < i.shipped && "text-status-critical font-medium")}>{nf(i.accepted)}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-hairline font-medium">
              <td className="px-4 sm:px-5 py-2">Всего</td>
              <td className={clsx("px-2 sm:px-3 py-2 text-right tabular-nums", accepting && "hidden sm:table-cell")}>{nf(card.ordered)}</td>
              <td className="px-2 sm:px-3 py-2 text-right tabular-nums">{card.shipped > 0 ? nf(card.shipped) : "—"}</td>
              <td className="px-4 sm:px-5 py-2 text-right tabular-nums">{accepting ? nf(acceptedNow) : card.accepted > 0 || card.shortage > 0 ? nf(card.accepted) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {missingTotal > 0 && !accepting && (
        <div className="px-4 sm:px-5 py-2.5 text-sm border-t border-line-hairline text-[#8a5a00] bg-status-warning/10">
          Склад не отгрузит {nf(missingTotal)} шт. — причины в позициях. Нужно по-прежнему — закажите на следующую фуру.
        </div>
      )}

      {card.shortage > 0 && !accepting && (
        <div className="px-4 sm:px-5 py-2.5 text-sm border-t border-line-hairline text-status-critical">
          Недостача {nf(card.shortage)} шт.{card.shortageNote ? ` — ${card.shortageNote}` : ""}
        </div>
      )}

      {accepting && (
        <div className="px-4 sm:px-5 py-3 border-t border-line-hairline space-y-3">
          {short > 0 && (
            <label className="block text-sm">
              <span className="label">Не хватает {nf(short)} шт. — что случилось?</span>
              <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Не доложили, бой в дороге, пересорт…" />
            </label>
          )}
          <p className="text-xs text-ink-muted">
            {card.wholesale ? "Принятое ляжет на склад города. " : "Это заказ в магазины: на склад города он не ложится, приёмка — для сверки со складом. "}
            Исправить приёмку потом может только администратор.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy} onClick={accept}>
              {busy ? "Записываю…" : `Подтвердить приёмку: ${nf(acceptedNow)} шт.`}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMode("view")}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {mode === "cancel" && (
        <div className="px-4 sm:px-5 py-3 border-t border-line-hairline flex flex-wrap items-center gap-2">
          <span className="text-sm mr-auto">Отменить этот заказ? Склад его больше не увидит.</span>
          <button type="button" className="btn-danger disabled:opacity-50" disabled={busy} onClick={cancel}>
            {busy ? "Отменяю…" : "Да, отменить"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMode("view")}>
            Не отменять
          </button>
        </div>
      )}

      {mode === "view" && ((canAccept && card.pending > 0) || (canCancel && card.stage === "waiting")) && (
        <div className="px-4 sm:px-5 py-3 border-t border-line-hairline flex flex-wrap gap-2">
          {canAccept && card.pending > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                // Цифры — на сейчас: склад мог дописать отгрузку, пока карточка была на экране.
                setGot(Object.fromEntries(pendingItems.map((i) => [i.itemId, String(i.pending)])));
                setNote("");
                setDone(null);
                setMode("accept");
              }}
            >
              Принять фуру
            </button>
          )}
          {canCancel && card.stage === "waiting" && (
            <button type="button" className="btn-secondary" onClick={() => setMode("cancel")}>
              Отменить заказ
            </button>
          )}
        </div>
      )}

      {error && <div className="mx-4 sm:mx-5 mb-3 text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      {done && <div className="mx-4 sm:mx-5 mb-3 text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2">{done}</div>}
    </div>
  );
}
