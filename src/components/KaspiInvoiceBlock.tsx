"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  cancelKaspiInvoiceAction,
  loadKaspiAction,
  refreshKaspiInvoiceAction,
  sendKaspiInvoiceAction,
  type KaspiPanelData,
} from "@/app/finance/kaspi-actions";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText, kaspiStatusLabel } from "@/lib/kaspiInvoice";
import { formatMoment } from "@/lib/formatDate";
import { unwrap, unwrapValue } from "@/lib/actionResult";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const prettyPhone = (p: string) => (p.length === 11 ? `${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : p);

/**
 * «Счёт в Kaspi» в панели оплаты: выставить счёт на телефон клиента через
 * ApiPay и видеть, что с ним. Оплаченный счёт проводится платежом сам
 * (вебхук), здесь — только отправка, статус, «обновить» и «отменить».
 * Данные грузит сама: панель оплаты стоит в трёх местах, и тянуть счета через
 * каждое значило бы три копии одного и того же.
 */
export default function KaspiInvoiceBlock({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [data, setData] = useState<KaspiPanelData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { phone: string; amount: string }>>({});

  const load = useCallback(async () => {
    try {
      const d = unwrapValue(await loadKaspiAction(orderId));
      setData(d);
      setForm((prev) => {
        const next = { ...prev };
        for (const f of d.farms) {
          if (!next[f.farm]) next[f.farm] = { phone: d.phone, amount: f.due > 0 ? String(f.due) : "" };
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

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    } finally {
      setBusy(null);
    }
  }

  if (hidden || !data) return null;
  const configured = data.farms.filter((f) => f.configured);
  if (data.farms.length === 0 || (configured.length === 0 && data.invoices.length === 0)) return null;

  return (
    <div className="rounded-lg border border-line-hairline p-3 space-y-3">
      <div className="text-sm font-medium">Счёт в Kaspi Pay</div>

      {data.farms.map((f) => {
        const open = data.invoices.some((i) => i.farm === f.farm && isOpenKaspiStatus(i.status));
        if (!f.configured) {
          return data.farms.length > 1 ? (
            <p key={f.farm} className="text-xs text-ink-muted">
              {f.label}: касса Kaspi не подключена — счёт выставляется вручную.
            </p>
          ) : null;
        }
        if (f.due <= 0) {
          return (
            <p key={f.farm} className="text-xs text-status-good">
              {f.label}: оплачено.
            </p>
          );
        }
        if (open) {
          return (
            <p key={f.farm} className="text-xs text-ink-secondary">
              {f.label}: счёт отправлен, ждём оплаты.
            </p>
          );
        }
        const v = form[f.farm] ?? { phone: data.phone, amount: String(f.due) };
        return (
          <form
            key={f.farm}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(`send-${f.farm}`, async () => {
                const r = unwrapValue(
                  await sendKaspiInvoiceAction({ orderId, farm: f.farm, phone: v.phone, amount: Number(v.amount.replace(/\s/g, "")) })
                );
                return r.sandbox ? "Счёт создан в ТЕСТОВОМ режиме ApiPay — клиенту он не придёт." : "Счёт отправлен клиенту в Kaspi.";
              });
            }}
          >
            {data.farms.length > 1 && <span className="text-xs text-ink-secondary w-full">{f.label}</span>}
            <label className="block">
              <span className="block text-xs text-ink-secondary">Номер в Kaspi</span>
              <input
                className="input !w-44 !py-1.5"
                inputMode="tel"
                value={v.phone}
                placeholder="8 7XX XXX XX XX"
                onChange={(e) => setForm({ ...form, [f.farm]: { ...v, phone: e.target.value } })}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-ink-secondary">Сумма, ₸</span>
              <input
                className="input !w-32 !py-1.5 tabular-nums"
                inputMode="numeric"
                value={v.amount}
                onChange={(e) => setForm({ ...form, [f.farm]: { ...v, amount: e.target.value } })}
              />
            </label>
            <button className="btn-primary !py-1.5 disabled:opacity-50" disabled={busy !== null}>
              {busy === `send-${f.farm}` ? "Отправляю…" : "Выставить счёт"}
            </button>
            {data.phoneSource && v.phone === data.phone && (
              <span className="text-xs text-ink-muted w-full">номер взят: {data.phoneSource}</span>
            )}
          </form>
        );
      })}

      {data.invoices.length > 0 && (
        <ul className="divide-y divide-line-hairline/70 text-sm">
          {data.invoices.map((i) => (
            <li key={i.invoiceId} className="py-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
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
              {i.sandbox && <span className="text-xs text-[#8a5a00]">тест</span>}
              <span className="text-xs text-ink-muted">
                №{i.invoiceId} · {prettyPhone(i.phone)} · {formatMoment(i.createdAt)}
                {data.farms.length > 1 && ` · ${data.farms.find((f) => f.farm === i.farm)?.label ?? i.farm}`}
              </span>
              {isPaidKaspiStatus(i.status) && (
                <span className="text-xs text-ink-secondary">
                  {i.paymentId && !i.paymentId.startsWith("claim-") ? "· платёж проведён" : "· проводится…"}
                </span>
              )}
              {(i.status === "error" || i.errorMessage) && (
                <span className="text-xs text-status-critical w-full">{kaspiErrorText(i.errorCode, i.errorMessage)}</span>
              )}
              <span className="ml-auto flex gap-3 text-xs">
                {(isOpenKaspiStatus(i.status) || i.status === "error") && (
                  <button
                    type="button"
                    className="text-accent hover:underline disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`refresh-${i.invoiceId}`, async () => {
                        const r = unwrapValue(await refreshKaspiInvoiceAction(i.invoiceId));
                        return `Статус: ${kaspiStatusLabel(r.status)}`;
                      })
                    }
                  >
                    {busy === `refresh-${i.invoiceId}` ? "…" : "обновить"}
                  </button>
                )}
                {isOpenKaspiStatus(i.status) && i.status !== "cancelling" && (
                  <button
                    type="button"
                    className="text-status-critical hover:underline disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`cancel-${i.invoiceId}`, async () => {
                        unwrap(await cancelKaspiInvoiceAction(i.invoiceId));
                        return "Счёт отменяется.";
                      })
                    }
                  >
                    отменить
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-status-critical">{error}</p>}
      {note && <p className="text-sm text-status-good">{note}</p>}
    </div>
  );
}
