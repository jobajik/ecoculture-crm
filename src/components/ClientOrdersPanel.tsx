"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Icon from "./Icon";
import Pill from "./Pill";
import Pager, { pageSlice } from "./Pager";
import OrderStageBadge from "./OrderStageBadge";
import type { OrderStage } from "@/lib/orderStage";
import type { PayTone } from "@/lib/orderPay";

/**
 * Правая часть карточки клиента по прототипу владельца: одна карточка с вкладками «Заявки», «Платежи», «Kaspi»,
 * «Переписка», поиском, порядком и листанием страницами — всё на одном экране, без прокрутки
 * (19.10.2026: «одностраничный и удобный»). «Выгрузить» — то, что сейчас на вкладке, файлом для Excel.
 * Данные готовит сервер (`clients/[id]/page.tsx`).
 */
export interface PanelOrder {
  orderId: string;
  code: string;
  date: string;
  item: string;
  more: number;
  total: number;
  paid: number;
  payTone: PayTone;
  payLabel: string;
  stage: OrderStage;
}
export interface PanelPayment {
  id: string;
  date: string;
  amount: number;
  method: string;
  farm: string;
  orderId: string;
  code: string;
}
export interface PanelKaspi {
  id: string;
  date: string;
  amount: number;
  phone: string;
  statusLabel: string;
  tone: PayTone;
  orderId: string;
  code: string;
}
export interface PanelMessage {
  id: string;
  at: string;
  out: boolean;
  text: string;
  who: string;
}

type Tab = "orders" | "payments" | "kaspi" | "chat";
const SIZE = 8;
const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ClientOrdersPanel({
  clientName,
  orders,
  payments,
  kaspi,
  messages,
}: {
  clientName: string;
  orders: PanelOrder[];
  payments: PanelPayment[];
  kaspi: PanelKaspi[];
  messages: PanelMessage[];
}) {
  const [tab, setTab] = useState<Tab>("orders");
  const [q, setQ] = useState("");
  const [newFirst, setNewFirst] = useState(true);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tab, q, newFirst]);

  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  const has = (...parts: (string | number)[]) =>
    !needle || parts.some((p) => String(p).toLowerCase().replace(/\s+/g, "").includes(needle));
  const order = <T,>(list: T[], key: (x: T) => string) =>
    [...list].sort((a, b) => (newFirst ? (key(a) < key(b) ? 1 : -1) : key(a) < key(b) ? -1 : 1));

  const lists = useMemo(
    () => ({
      orders: order(
        orders.filter((o) => has(o.code, o.item, o.total, o.payLabel, o.stage.label)),
        (o) => o.date
      ),
      payments: order(
        payments.filter((p) => has(p.code, p.amount, p.method, p.date)),
        (p) => p.date
      ),
      kaspi: order(
        kaspi.filter((k) => has(k.code, k.amount, k.phone, k.statusLabel)),
        (k) => k.date
      ),
      chat: order(
        messages.filter((m) => has(m.text, m.who)),
        (m) => m.at
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, payments, kaspi, messages, needle, newFirst]
  );
  const total = lists[tab].length;
  const day = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
  const dayShort = (iso: string) => (iso ? iso.slice(5, 10).split("-").reverse().join(".") : "—");

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "orders", label: "Заявки", n: orders.length },
    { key: "payments", label: "Платежи", n: payments.length },
    { key: "kaspi", label: "Kaspi", n: kaspi.length },
    { key: "chat", label: "Переписка", n: messages.length },
  ];

  const exportTab = () => {
    const base = clientName.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40);
    if (tab === "orders")
      downloadCsv(`${base}-zayavki.csv`, [
        ["№", "Дата", "Что заказали", "Сумма", "Оплачено", "Оплата", "Этап"],
        ...lists.orders.map((o) => [o.code, day(o.date), o.item + (o.more ? ` +${o.more}` : ""), Math.round(o.total), Math.round(o.paid), o.payLabel, o.stage.label]),
      ]);
    if (tab === "payments")
      downloadCsv(`${base}-platezhi.csv`, [
        ["Дата", "Сумма", "Способ", "Компания", "Заявка"],
        ...lists.payments.map((p) => [day(p.date), Math.round(p.amount), p.method, p.farm, p.code]),
      ]);
    if (tab === "kaspi")
      downloadCsv(`${base}-kaspi.csv`, [
        ["Дата", "Сумма", "Номер", "Статус", "Заявка"],
        ...lists.kaspi.map((k) => [day(k.date), Math.round(k.amount), k.phone, k.statusLabel, k.code]),
      ]);
    if (tab === "chat")
      downloadCsv(`${base}-perepiska.csv`, [
        ["Когда", "Кто", "Текст"],
        ...lists.chat.map((m) => [m.at.replace("T", " ").slice(0, 16), m.out ? m.who || "мы" : "клиент", m.text]),
      ]);
  };

  const th = "px-4 py-2.5 font-medium";
  const td = "px-4 py-2.5";

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
        <span className="w-8 h-8 rounded-lg grid place-items-center bg-accent-soft text-accent flex-none">
          <Icon name="order" className="w-4 h-4" />
        </span>
        <h2 className="font-display text-[15px] font-bold">Заявки и деньги клиента</h2>
        <button type="button" onClick={exportTab} className="btn-secondary !py-1.5 ml-auto" disabled={total === 0}>
          Выгрузить
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-2 px-4 sm:px-5 border-b border-line-hairline">
        <div className="flex gap-5 overflow-x-auto scroll-x-hidden flex-none">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={clsx(
                "py-3 text-[13.5px] whitespace-nowrap border-b-2 -mb-px transition-colors",
                tab === t.key ? "border-accent text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
              )}
            >
              {t.label} <span className="text-ink-muted font-normal">({t.n})</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 md:ml-auto pb-2.5 md:pb-0">
          <input
            className="input !py-1.5 !min-h-0 md:!w-[180px]"
            placeholder="Поиск по номеру, сорту, сумме…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setNewFirst((v) => !v)}
            className="btn-secondary !py-1.5 whitespace-nowrap"
            title="Поменять порядок"
          >
            {newFirst ? "Сначала новые" : "Сначала старые"}
          </button>
        </div>
      </div>

      {tab === "orders" && (
        <div className="table-scroll table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className={th}>№</th>
                <th className={th}>Дата</th>
                <th className={th}>Что заказали</th>
                <th className={clsx(th, "text-right")}>Сумма</th>
                <th className={th}>Оплата</th>
                <th className={th}>Этап</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice(lists.orders, page, SIZE).map((o) => (
                <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                  <td data-label="Заявка" className={clsx(td, "whitespace-nowrap")}>
                    <Link href={`/orders/${o.orderId}`} className="font-mono text-[12.5px] text-ink-secondary hover:text-accent">
                      {o.code}
                    </Link>
                  </td>
                  <td data-label="Дата" className={clsx(td, "text-ink-secondary whitespace-nowrap")}>
                    {dayShort(o.date)}
                  </td>
                  <td data-label="Что заказали" className={clsx(td, "text-ink-secondary")}>
                    <span className="truncate inline-block max-w-[220px] align-bottom" title={o.item}>
                      {o.item}
                    </span>
                    {o.more > 0 && <span className="text-ink-muted"> +{o.more}</span>}
                  </td>
                  <td data-label="Сумма" className={clsx(td, "text-right tabular-nums whitespace-nowrap")}>
                    {money(o.total)}
                  </td>
                  <td data-label="Оплата" className={td} title={o.paid > 0 ? `Оплачено ${money(o.paid)}` : undefined}>
                    <Pill tone={o.payTone}>{o.payLabel}</Pill>
                  </td>
                  <td data-label="Этап" className={td}>
                    <OrderStageBadge stage={o.stage} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payments" && (
        <div className="table-scroll table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className={th}>Дата</th>
                <th className={clsx(th, "text-right")}>Сумма</th>
                <th className={th}>Способ</th>
                <th className={th}>Компания</th>
                <th className={th}>Заявка</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice(lists.payments, page, SIZE).map((p) => (
                <tr key={p.id} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                  <td data-label="Дата" className={clsx(td, "whitespace-nowrap")}>{day(p.date)}</td>
                  <td data-label="Сумма" className={clsx(td, "text-right tabular-nums font-semibold whitespace-nowrap")}>{money(p.amount)}</td>
                  <td data-label="Способ" className={clsx(td, "text-ink-secondary")}>{p.method || "—"}</td>
                  <td data-label="Компания" className={clsx(td, "text-ink-secondary")}>{p.farm || "—"}</td>
                  <td data-label="Заявка" className={td}>
                    <Link href={`/orders/${p.orderId}`} className="font-mono text-[12.5px] text-ink-secondary hover:text-accent">
                      {p.code}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "kaspi" && (
        <div className="table-scroll table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className={th}>Дата</th>
                <th className={clsx(th, "text-right")}>Сумма</th>
                <th className={th}>Номер</th>
                <th className={th}>Статус</th>
                <th className={th}>Заявка</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice(lists.kaspi, page, SIZE).map((k) => (
                <tr key={k.id} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                  <td data-label="Дата" className={clsx(td, "whitespace-nowrap")}>{day(k.date)}</td>
                  <td data-label="Сумма" className={clsx(td, "text-right tabular-nums font-semibold whitespace-nowrap")}>{money(k.amount)}</td>
                  <td data-label="Номер" className={clsx(td, "text-ink-secondary whitespace-nowrap")}>{k.phone || "—"}</td>
                  <td data-label="Статус" className={td}>
                    <Pill tone={k.tone}>{k.statusLabel}</Pill>
                  </td>
                  <td data-label="Заявка" className={td}>
                    <Link href={`/orders/${k.orderId}`} className="font-mono text-[12.5px] text-ink-secondary hover:text-accent">
                      {k.code}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "chat" && (
        <div className="px-4 sm:px-5 py-4 space-y-2.5 bg-surface-plane/40">
          {pageSlice(lists.chat, page, SIZE).map((m) => (
            <div key={m.id} className={clsx("flex", m.out ? "justify-end" : "justify-start")}>
              <div
                className={clsx(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug shadow-card",
                  m.out ? "bg-accent-soft text-ink-primary rounded-br-md" : "bg-surface border border-line-hairline rounded-bl-md"
                )}
              >
                <div className="whitespace-pre-wrap break-words line-clamp-4">{m.text || "—"}</div>
                <div className="text-[11px] text-ink-muted mt-1">
                  {m.at.replace("T", " ").slice(0, 16).split(" ")[0].split("-").reverse().join(".")} {m.at.slice(11, 16)}
                  {m.out && m.who ? ` · ${m.who}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {total === 0 && (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">
          {q ? "Ничего не нашлось" : tab === "chat" ? "Переписки в WhatsApp с этим номером нет" : "Пока пусто"}
        </div>
      )}
      <Pager total={total} page={page} onPage={setPage} size={SIZE} />
    </div>
  );
}
