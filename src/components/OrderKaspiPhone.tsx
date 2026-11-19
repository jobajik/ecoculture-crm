"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setOrderKaspiPhoneAction } from "@/app/orders/actions";
import { unwrapValue } from "@/lib/actionResult";

/**
 * Номер Kaspi для счёта по заявке (19.11.2026, `orderKaspiPhone.ts`). Показывает, на какой номер пойдёт счёт, и даёт
 * менеджеру заявки (РОПу, бухгалтеру, админу) его поменять: клиент попросил «отправьте на другой номер». Счёт, который
 * ждёт оплаты на прежнем номере, сервер отменит и выставит заново — об этом сказано до нажатия.
 */
export default function OrderKaspiPhone({
  orderId,
  current,
  source,
  cardNumbers,
  waiting,
  canEdit,
  canRemember,
}: {
  orderId: string;
  /** Номер, на который сейчас пойдёт счёт («8 701 555 20 30»); пусто — номера нет. */
  current: string;
  /** Откуда он: «указан в заявке», «из карточки клиента», «телефон клиента». */
  source: string;
  /** Номера Kaspi из карточки клиента — подставить одним нажатием. */
  cardNumbers: string[];
  /** Счета, которые ждут оплаты: на каком номере и сколько. */
  waiting: { phone: string; amount: number; farmLabel: string }[];
  canEdit: boolean;
  /** Может ли этот человек править карточку клиента (иначе галочки «запомнить» нет). */
  canRemember: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const digits = (v: string) => v.replace(/\D/g, "");
  const same = (a: string, b: string) => digits(a).slice(-10) === digits(b).slice(-10) && digits(a).length >= 10;
  const toMove = phone ? waiting.filter((w) => !same(w.phone, phone)) : [];

  async function save(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = unwrapValue(await setOrderKaspiPhoneAction(orderId, { phone: value, remember }));
      setDone(res.lines);
      setOpen(false);
      setPhone("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить номер");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line-hairline px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ink-secondary">Счёт Kaspi — на номер</span>
        {current ? (
          <span className="font-medium tabular-nums whitespace-nowrap">{current}</span>
        ) : (
          <span className="text-status-critical">номера нет</span>
        )}
        {current && source && <span className="text-xs text-ink-muted">{source}</span>}
        {canEdit && !open && (
          <button type="button" className="ml-auto text-accent text-[13px] font-medium hover:underline" onClick={() => { setOpen(true); setDone([]); setError(null); }}>
            {current ? "Изменить номер" : "Указать номер"}
          </button>
        )}
      </div>

      {waiting.length > 0 && !open && (
        <div className="text-xs text-ink-muted mt-1">
          Ждёт оплаты:{" "}
          {waiting.map((w, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              {w.farmLabel} <span className="whitespace-nowrap">{w.amount.toLocaleString("ru-RU")} ₸</span> на <span className="whitespace-nowrap">{w.phone}</span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="label">Номер Kaspi клиента</span>
            <input
              className="input max-w-xs"
              inputMode="tel"
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, "").slice(0, 20))}
              placeholder="8 7XX XXX XX XX"
            />
          </label>
          {cardNumbers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-muted">из карточки:</span>
              {cardNumbers.map((n) => (
                <button key={n} type="button" className="h-7 px-2.5 rounded-md border border-line-hairline hover:border-accent tabular-nums" onClick={() => setPhone(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
          {canRemember && (
            <label className="flex items-start gap-2 text-ink-secondary">
              <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Запомнить в карточке клиента как основной номер Kaspi (прежний останется вторым)</span>
            </label>
          )}
          {toMove.length > 0 && (
            <p className="text-xs text-[#8a5a00] bg-status-warning/10 rounded-md px-2.5 py-2">
              {toMove.length === 1 ? "Счёт" : "Счета"} {toMove.map((w) => `на ${w.amount.toLocaleString("ru-RU")} ₸ (${w.farmLabel}, ${w.phone})`).join(" и ")} {toMove.length === 1 ? "ждёт" : "ждут"} оплаты на
              прежнем номере: {toMove.length === 1 ? "он будет отменён и выставлен" : "они будут отменены и выставлены"} заново на новый.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy || digits(phone).length < 10} onClick={() => save(phone)}>
              {busy ? "Сохраняю…" : toMove.length > 0 ? "Сохранить и перевыставить счёт" : "Сохранить номер"}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-2 text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      {done.length > 0 && (
        <ul className="mt-2 text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2 space-y-0.5">
          {done.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
