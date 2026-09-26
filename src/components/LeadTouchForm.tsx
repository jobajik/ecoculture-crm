"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { addTouchAction } from "@/app/clients/leads/actions";
import { CLIENT_STAGES, LEAD_CHANNELS, LEAD_LOST_REASONS, LEAD_STAGES, isClosedStage } from "@/lib/leads";
import { unwrap } from "@/lib/actionResult";
import type { TouchPrefill } from "@/lib/talkAnalysis";
import { TOUCH_PREFILL_EVENT } from "./LeadTalkPanel";

function plusDays(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Касание: как связывались, что сказали, куда сдвинулась стадия и когда
 * следующий разговор. Следующая дата обязательна у открытого лида — иначе он
 * выпадет из «На сегодня» и про него забудут.
 */
export default function LeadTouchForm({
  leadId,
  stage,
  hasClient,
  today,
}: {
  leadId: string;
  stage: string;
  hasClient: boolean;
  today: string;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<string>(LEAD_CHANNELS[0]);
  const [comment, setComment] = useState("");
  const [nextStage, setNextStage] = useState(stage);
  const [nextTouchAt, setNextTouchAt] = useState(plusDays(today, 2));
  const [lostReason, setLostReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [fromAi, setFromAi] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // «Перенести в касание» в разборе переписки заполняет эту форму — записывает
  // её менеджер сам, прочитав и поправив (ИИ только предлагает).
  useEffect(() => {
    function onPrefill(e: Event) {
      const p = (e as CustomEvent<TouchPrefill>).detail;
      if (!p) return;
      setChannel(p.channel);
      setComment(p.comment);
      setNextStage(p.stage);
      if (p.nextTouchAt) setNextTouchAt(p.nextTouchAt);
      setLostReason(p.lostReason);
      setSaved(false);
      setError(null);
      setFromAi(true);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(TOUCH_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(TOUCH_PREFILL_EVENT, onPrefill);
  }, []);

  const closed = isClosedStage(nextStage);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      unwrap(await addTouchAction(leadId, { channel, comment, stage: nextStage, nextTouchAt, lostReason }));
      setComment("");
      setFromAi(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={save} className={clsx("card space-y-3", fromAi && "ring-2 ring-section-leads/40")}>
      <h2 className="font-semibold">Новое касание</h2>
      {fromAi && (
        <p className="text-sm text-section-leads -mt-1">Заполнено из разбора переписки — проверьте и запишите.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {LEAD_CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={clsx(
              "rounded-full border px-3 py-1 text-sm",
              channel === c ? "border-accent bg-accent/10 font-medium" : "border-line-hairline text-ink-secondary"
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-sm text-ink-secondary">О чём поговорили, что решили *</span>
        <textarea
          className="input min-h-[90px]"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Например: говорил с Айгуль, берут хризантему к выходным, просят прайс в WhatsApp"
          maxLength={3000}
        />
      </label>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-sm text-ink-secondary">Стадия</span>
          <select className="input" value={nextStage} onChange={(e) => setNextStage(e.target.value)}>
            {LEAD_STAGES.map((s) => (
              <option key={s.key} value={s.key} disabled={CLIENT_STAGES.includes(s.key) && !hasClient}>
                {s.label}
                {CLIENT_STAGES.includes(s.key) && !hasClient ? " — сначала завести клиентом" : ""}
              </option>
            ))}
          </select>
        </label>
        {nextStage === "lost" ? (
          <label className="block">
            <span className="text-sm text-ink-secondary">Причина отказа *</span>
            <select className="input" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
              <option value="">—</option>
              {LEAD_LOST_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        ) : (
          !closed && (
            <label className="block">
              <span className="text-sm text-ink-secondary">Следующее касание *</span>
              <input
                type="date"
                className="input"
                value={nextTouchAt}
                min={today}
                onChange={(e) => setNextTouchAt(e.target.value)}
              />
              <span className="flex gap-2 mt-1 text-xs">
                {[1, 3, 7].map((n) => (
                  <button key={n} type="button" className="text-accent hover:underline" onClick={() => setNextTouchAt(plusDays(today, n))}>
                    {n === 1 ? "завтра" : `через ${n} дн.`}
                  </button>
                ))}
              </span>
            </label>
          )
        )}
      </div>
      {error && <p className="text-sm text-status-critical">{error}</p>}
      {saved && <p className="text-sm text-status-good">Касание записано.</p>}
      <button className="btn-primary disabled:opacity-50" disabled={saving}>
        {saving ? "Сохраняю…" : "Записать касание"}
      </button>
    </form>
  );
}
