"use client";

import { useState, useTransition } from "react";
import { saveBotSalesPhonesAction, testBotSalesAction } from "@/app/admin/digest-actions";
import { unwrapValue } from "@/lib/actionResult";

/** Номера, куда приходят продажи бота: «бот оформил заказ» и «оплачено — можно собирать». */
export default function BotSalesPhonesForm({ initial }: { initial: string }) {
  const [phones, setPhones] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = (fn: () => Promise<string>) => {
    setMsg(null);
    start(async () => {
      try {
        setMsg({ ok: true, text: await fn() });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Не получилось" });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="bot-sales-phones">
          Кому присылать (WhatsApp, через запятую)
        </label>
        <input
          id="bot-sales-phones"
          className="input"
          value={phones}
          onChange={(e) => setPhones(e.target.value)}
          placeholder="+7 701 000 00 00, +7 702 000 00 00"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = unwrapValue(await saveBotSalesPhonesAction(phones));
              return r.count ? `Сохранено: ${r.count} ном.` : "Сообщения о продажах выключены";
            })
          }
        >
          Сохранить
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending || !initial}
          onClick={() =>
            act(async () => {
              const r = unwrapValue(await testBotSalesAction());
              return `Пробное сообщение ушло на ${r.sent} ном.`;
            })
          }
        >
          Отправить пробное
        </button>
      </div>
      {pending && <p className="text-sm text-ink-muted">Секунду…</p>}
      {msg?.text && <p className={`text-sm ${msg.ok ? "text-status-good" : "text-status-critical"}`}>{msg.text}</p>}
    </div>
  );
}
