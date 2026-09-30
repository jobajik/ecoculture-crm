"use client";

import { useState, useTransition } from "react";
import { previewDigestAction, saveDigestPhonesAction, sendDigestNowAction } from "@/app/admin/digest-actions";
import { unwrapValue } from "@/lib/actionResult";

/** Номера для утренней сводки, предпросмотр и отправка «сейчас» для проверки. */
export default function DigestForm({ initial }: { initial: string }) {
  const [phones, setPhones] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState("");

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
        <label className="label" htmlFor="digest-phones">
          Кому присылать (WhatsApp, через запятую)
        </label>
        <input
          id="digest-phones"
          className="input"
          value={phones}
          onChange={(e) => setPhones(e.target.value)}
          placeholder="+7 701 000 00 00"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = unwrapValue(await saveDigestPhonesAction(phones));
              return r.count ? `Сохранено: ${r.count} ном.` : "Сводка выключена";
            })
          }
        >
          Сохранить
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            act(async () => {
              setPreview(unwrapValue(await previewDigestAction()).text);
              return "";
            })
          }
        >
          Как выглядит
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending || !initial}
          onClick={() =>
            act(async () => {
              const r = unwrapValue(await sendDigestNowAction());
              return `Отправлено на ${r.sent} ном.${r.note ? ` · ${r.note}` : ""}`;
            })
          }
        >
          Отправить сейчас
        </button>
      </div>
      {pending && <p className="text-sm text-ink-muted">Секунду…</p>}
      {msg?.text && <p className={`text-sm ${msg.ok ? "text-status-good" : "text-status-critical"}`}>{msg.text}</p>}
      {preview && <pre className="whitespace-pre-wrap font-sans text-sm bg-surface-plane rounded-lg p-3">{preview}</pre>}
    </div>
  );
}
