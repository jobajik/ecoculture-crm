"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { handoverLeadAction } from "@/app/clients/leads/actions";
import { unwrapValue } from "@/lib/actionResult";
import Section from "./Section";

/**
 * Земфира передаёт лид с рекламы менеджеру: кому и что клиенту нужно. После передачи лид
 * ведёт менеджер (минимум 2, максимум 5 касаний), а Земфира видит итог.
 */
export default function LeadHandoverForm({ leadId, managers }: { leadId: string; managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = unwrapValue(await handoverLeadAction(leadId, { managerEmail: to, comment }));
      setDone(`Передан: ${r.managerName}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось передать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section tone="leads" icon="client" title="Передать менеджеру" className="!mb-0">
      {done ? (
        <p className="text-sm text-status-good">{done}</p>
      ) : (
        <form onSubmit={submit} className="space-y-2 text-sm">
          <label className="block">
            <span className="block text-ink-secondary mb-1">Менеджер</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">— выберите —</option>
              {managers.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-ink-secondary mb-1">Что клиенту нужно и о чём договорились</span>
            <textarea
              className="input min-h-[80px]"
              value={comment}
              maxLength={2000}
              placeholder="Например: цветочный магазин в Каскелене, берёт хризантему 2-й категории, ~500 шт. в неделю, ждёт звонка завтра до обеда"
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error && <p className="text-status-critical">{error}</p>}
          <button type="submit" className="btn-primary !py-1.5 disabled:opacity-50" disabled={busy || !to || comment.trim().length < 3}>
            {busy ? "Передаю…" : "Передать"}
          </button>
          <p className="text-xs text-ink-muted">Менеджеру касание назначится на сегодня. Дальше лид ведёт он, а вам виден итог.</p>
        </form>
      )}
    </Section>
  );
}
