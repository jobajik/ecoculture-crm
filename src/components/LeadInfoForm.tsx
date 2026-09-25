"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { convertLeadAction, takeLeadAction, updateLeadAction } from "@/app/clients/leads/actions";
import { CLIENT_SOURCES, CLIENT_TYPES, PAYMENT_TERMS } from "@/lib/constants";
import { whatsappLink } from "@/lib/leads";
import type { Lead } from "@/lib/types";
import { unwrap, unwrapValue } from "@/lib/actionResult";

type Info = Pick<Lead, "name" | "city" | "phone" | "contactPerson" | "clientType" | "source" | "address" | "note" | "managerEmail">;

/**
 * Карточка лида: кто это и как связаться, правка, передача (РОП), «взять себе»
 * (ничей лид) и «завести клиентом» — без карточки клиента заявку не оформить.
 */
export default function LeadInfoForm({
  lead,
  canWork,
  canManage,
  canTake,
  managers,
  managerName,
  clientName,
}: {
  lead: Lead;
  canWork: boolean;
  canManage: boolean;
  canTake: boolean;
  managers: { email: string; name: string }[];
  managerName: string;
  clientName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Info>({
    name: lead.name,
    city: lead.city,
    phone: lead.phone,
    contactPerson: lead.contactPerson,
    clientType: lead.clientType,
    source: lead.source,
    address: lead.address,
    note: lead.note,
    managerEmail: lead.managerEmail,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terms, setTerms] = useState("");
  const [converting, setConverting] = useState(false);

  const set = (k: keyof Info) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    } finally {
      setBusy(false);
    }
  }

  const wa = whatsappLink(lead.phone);

  return (
    <section className="card space-y-3 min-w-0">
      {!editing ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-secondary">Телефон</dt>
            <dd className="min-w-0">
              {lead.phone ? (
                <span className="flex flex-wrap gap-x-3">
                  <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline tabular-nums">
                    {lead.phone}
                  </a>
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      WhatsApp ↗
                    </a>
                  )}
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-ink-secondary">Контакт</dt>
            <dd>{lead.contactPerson || "—"}</dd>
            <dt className="text-ink-secondary">Город</dt>
            <dd>{lead.city || "—"}</dd>
            {lead.address && (
              <>
                <dt className="text-ink-secondary">Адрес</dt>
                <dd>{lead.address}</dd>
              </>
            )}
            <dt className="text-ink-secondary">Тип · источник</dt>
            <dd>{[lead.clientType, lead.source].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-ink-secondary">Менеджер</dt>
            <dd>{managerName || <span className="text-[#8a5a00]">ничей</span>}</dd>
            {lead.note && (
              <>
                <dt className="text-ink-secondary">Заметка</dt>
                <dd className="whitespace-pre-line">{lead.note}</dd>
              </>
            )}
            {lead.clientId && (
              <>
                <dt className="text-ink-secondary">Клиент</dt>
                <dd>
                  <Link href={`/clients/${lead.clientId}`} className="text-accent hover:underline">
                    {clientName || "карточка клиента"} →
                  </Link>
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            {canTake && (
              <button
                type="button"
                className="btn-primary !py-1.5 disabled:opacity-50"
                disabled={busy}
                onClick={() => run(async () => { unwrap(await takeLeadAction(lead.leadId)); })}
              >
                Взять себе
              </button>
            )}
            {(canWork || canManage) && (
              <button type="button" className="btn-secondary !py-1.5" onClick={() => setEditing(true)}>
                Изменить
              </button>
            )}
            {canWork && !lead.clientId && !converting && (
              <button type="button" className="btn-secondary !py-1.5" onClick={() => setConverting(true)}>
                Завести клиентом
              </button>
            )}
            {lead.clientId && canWork && (
              <Link href={`/orders/new?client=${lead.clientId}`} className="btn-primary !py-1.5">
                + Заявка
              </Link>
            )}
          </div>
          {converting && (
            <div className="rounded-lg border border-line-hairline bg-surface-plane p-3 space-y-2 text-sm">
              <p>
                Заведу карточку клиента с этими данными и переведу лид на «Пробный заказ». Если клиент с этим
                телефоном уже есть — привяжу к нему.
              </p>
              <label className="flex flex-wrap items-center gap-2">
                <span className="text-ink-secondary">Условия оплаты</span>
                <select className="input !w-auto !py-1" value={terms} onChange={(e) => setTerms(e.target.value)}>
                  <option value="">не знаю пока</option>
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary !py-1.5 disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      unwrapValue(await convertLeadAction(lead.leadId, { paymentTerms: terms }));
                      setConverting(false);
                    })
                  }
                >
                  {busy ? "Завожу…" : "Завести"}
                </button>
                <button type="button" className="btn-secondary !py-1.5" onClick={() => setConverting(false)}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              unwrap(await updateLeadAction(lead.leadId, form));
              setEditing(false);
            });
          }}
        >
          <div className="grid sm:grid-cols-2 gap-3">
            {(
              [
                ["name", "Название"],
                ["city", "Город"],
                ["phone", "Телефон"],
                ["contactPerson", "Контактное лицо"],
                ["address", "Адрес"],
              ] as [keyof Info, string][]
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-sm text-ink-secondary">{label}</span>
                <input className="input" value={form[k]} onChange={set(k)} />
              </label>
            ))}
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
            {canManage && (
              <label className="block">
                <span className="text-sm text-ink-secondary">Менеджер</span>
                <select className="input" value={form.managerEmail} onChange={set("managerEmail")}>
                  <option value="">Ничей</option>
                  {managers.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="text-sm text-ink-secondary">Заметка</span>
              <textarea className="input min-h-[60px]" value={form.note} onChange={set("note")} />
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 disabled:opacity-50" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" className="btn-secondary !py-1.5" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-status-critical">{error}</p>}
    </section>
  );
}
