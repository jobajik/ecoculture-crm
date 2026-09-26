"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction } from "@/app/clients/leads/actions";
import { CLIENT_SOURCES, CLIENT_TYPES } from "@/lib/constants";
import { unwrapValue } from "@/lib/actionResult";

const EMPTY = { name: "", city: "", phone: "", contactPerson: "", clientType: "", source: "", address: "", note: "", managerEmail: "" };

/**
 * Новый лид вручную. Обязательно название и телефон или контакт — без них
 * звонить некому. Менеджер заводит лид на себя; РОП может сразу отдать его
 * менеджеру или оставить ничьим.
 */
export default function NewLeadForm({
  canManage,
  managers,
  initial,
}: {
  canManage: boolean;
  managers: { email: string; name: string }[];
  /** Заполненная форма — из «Написали в WhatsApp»: номер и имя уже известны. */
  initial?: Partial<typeof EMPTY>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!initial);
  const [form, setForm] = useState({ ...EMPTY, ...(initial ?? {}) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = unwrapValue(await createLeadAction(form));
      setForm(EMPTY);
      setOpen(false);
      setNote(
        res.similar.length > 0
          ? `Лид заведён. Похожие по названию: ${res.similar.map((s) => `${s.name}${s.city ? ` (${s.city})` : ""}`).join(", ")} — проверьте, не двойник ли.`
          : "Лид заведён — он уже в списке «На сегодня»."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary !py-1.5" onClick={() => { setOpen(true); setNote(null); }}>
          + Лид
        </button>
        {note && <span className="text-sm text-status-good">{note}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="card space-y-3 basis-full">
      <h2 className="font-semibold">Новый лид</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-sm text-ink-secondary">Название *</span>
          <input className="input" value={form.name} onChange={set("name")} required maxLength={200} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">Город</span>
          <input className="input" value={form.city} onChange={set("city")} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">Телефон</span>
          <input className="input" value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="+7 7__ ___ __ __" />
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">Контактное лицо</span>
          <input className="input" value={form.contactPerson} onChange={set("contactPerson")} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">Тип точки</span>
          <select className="input" value={form.clientType} onChange={set("clientType")}>
            <option value="">—</option>
            {CLIENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-ink-secondary">Источник</span>
          <select className="input" value={form.source} onChange={set("source")}>
            <option value="">—</option>
            {CLIENT_SOURCES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="text-sm text-ink-secondary">Адрес</span>
          <input className="input" value={form.address} onChange={set("address")} />
        </label>
        {canManage && (
          <label className="block">
            <span className="text-sm text-ink-secondary">Менеджер</span>
            <select className="input" value={form.managerEmail} onChange={set("managerEmail")}>
              <option value="">Ничей — возьмёт любой менеджер</option>
              {managers.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="text-sm text-ink-secondary">Комментарий</span>
          <textarea className="input min-h-[60px]" value={form.note} onChange={set("note")} placeholder="Что известно: что берут, объёмы, откуда контакт" />
        </label>
      </div>
      {error && <p className="text-sm text-status-critical">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary disabled:opacity-50" disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
