"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBotSettingsAction } from "@/app/clients/broadcasts/actions";
import { unwrap } from "@/lib/actionResult";
import type { BotSettings } from "@/lib/broadcast";

/** Настройки бота-автоответчика и дневной предел рассылок. */
export default function BotSettingsForm({ initial, dailyLimit }: { initial: BotSettings; dailyLimit: number }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [limit, setLimit] = useState(String(dailyLimit));
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<BotSettings>) => setS((prev) => ({ ...prev, ...patch }));

  function save() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await saveBotSettingsAction({ ...s, dailyLimit: Number(limit) }));
        setNote("Сохранено.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не сохранилось");
      }
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-base font-medium">
        <input type="checkbox" className="h-5 w-5" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Бот отвечает клиентам в WhatsApp
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="label">Кому отвечает</span>
          <select className="input" value={s.scope} onChange={(e) => set({ scope: e.target.value === "all" ? "all" : "broadcast" })}>
            <option value="broadcast">Только тем, кому была рассылка (рекомендую)</option>
            <option value="all">Всем, кто пишет</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="label">Когда</span>
          <select className="input" value={s.hours} onChange={(e) => set({ hours: e.target.value === "offhours" ? "offhours" : "always" })}>
            <option value="always">Круглосуточно</option>
            <option value="offhours">Только в нерабочее время</option>
          </select>
        </label>
        {s.hours === "offhours" && (
          <div className="flex items-end gap-2 text-sm sm:col-span-2">
            <label className="space-y-1">
              <span className="label">Менеджеры работают с</span>
              <input className="input !w-20" inputMode="numeric" value={s.workFrom} onChange={(e) => set({ workFrom: Number(e.target.value) || 0 })} />
            </label>
            <label className="space-y-1">
              <span className="label">до (часов)</span>
              <input className="input !w-20" inputMode="numeric" value={s.workTo} onChange={(e) => set({ workTo: Number(e.target.value) || 0 })} />
            </label>
          </div>
        )}
      </div>

      <label className="block space-y-1 text-sm">
        <span className="label">Что боту знать и как отвечать</span>
        <textarea
          className="input min-h-[160px]"
          placeholder="Например: доставка по Алматы бесплатно от 50 000 ₸. Минимальный заказ — 100 стеблей. Заявки до 16:00 — доставка на следующий день. Отвечай на «вы»."
          value={s.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
        />
        <span className="text-xs text-ink-muted">Цены, наличие на складе и текст последней рассылки бот знает сам. Здесь — скидки, доставка, условия оплаты. Собранный заказ, жалобу и просьбу позвать человека он передаёт менеджеру; не ответил за час — бот продолжает сам.</span>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="label">Рассылки: не больше сообщений в сутки</span>
        <input className="input !w-32" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <span className="block text-xs text-ink-muted">Для обычного WhatsApp безопаснее начинать со 100–150 в день и повышать постепенно.</span>
      </label>

      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
      {note && <p className="text-sm text-status-good">{note}</p>}
      <button type="button" className="btn-primary" onClick={save} disabled={pending}>
        {pending ? "Сохраняю…" : "Сохранить"}
      </button>
    </div>
  );
}
