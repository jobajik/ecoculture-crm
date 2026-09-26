"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { analyzeLeadTalkAction } from "@/app/clients/leads/talk-actions";
import { unwrapValue } from "@/lib/actionResult";
import { CHECKLIST, objectionLabel, type TouchPrefill } from "@/lib/talkAnalysis";
import { stageLabel } from "@/lib/leads";
import { minutesWords } from "@/lib/whatsapp";
import { formatMoment } from "@/lib/formatDate";
import type { LeadAnalysis } from "@/lib/types";
import Section from "./Section";
import Icon from "./Icon";
import { ScoreChip, TemperatureChip } from "./TalkChips";
import ChatImportForm from "./ChatImportForm";

/** Имя события, по которому форма касания заполняется из разбора (`LeadTouchForm`). */
export const TOUCH_PREFILL_EVENT = "lead-touch-prefill";

const MARK: Record<string, { sign: string; cls: string }> = {
  yes: { sign: "✓", cls: "bg-status-good/10 text-status-good" },
  no: { sign: "✗", cls: "bg-status-critical/10 text-status-critical" },
  na: { sign: "—", cls: "bg-surface-sunk text-ink-muted" },
};

/**
 * Разбор переписки ИИ в карточке лида: кратко, что нужно клиенту, о чём
 * договорились, что делать дальше, оценка менеджера по чек-листу, возражения
 * и подсказка стадии. ИИ только ПРЕДЛАГАЕТ: «Перенести в касание» заполняет
 * форму касания, а записывает её менеджер сам.
 */
export default function LeadTalkPanel({
  leadId,
  canRun,
  aiReady,
  analysis,
  prefill,
  newMessages,
  currentStage,
  hasMessages,
  waConnected,
  managerName,
}: {
  leadId: string;
  canRun: boolean;
  aiReady: boolean;
  analysis: LeadAnalysis | null;
  prefill: TouchPrefill | null;
  newMessages: number;
  currentStage: string;
  hasMessages: boolean;
  waConnected: boolean;
  managerName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = unwrapValue(await analyzeLeadTalkAction(leadId));
      setNote(res.pulled > 0 ? `Готово. Из WhatsApp подтянуто ${res.pulled} сообщ.` : "Готово.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось разобрать");
    } finally {
      setBusy(false);
    }
  }

  function toTouch() {
    if (!prefill) return;
    window.dispatchEvent(new CustomEvent(TOUCH_PREFILL_EVENT, { detail: prefill }));
  }

  // Разбирать нечего, пока нет ни сохранённой переписки, ни подключённого номера.
  const button = canRun && aiReady && (hasMessages || waConnected) && (
    <button type="button" className="btn-secondary !py-1 !px-3 !min-h-0 text-sm" onClick={run} disabled={busy}>
      {busy ? "Разбираю…" : analysis ? (newMessages > 0 ? `Разобрать заново · ${newMessages} нов.` : "Разобрать заново") : "Разобрать переписку"}
    </button>
  );

  return (
    <Section tone="leads" icon="chart" title="Разбор переписки" aside={button} className="!mb-0">
      {busy && <p className="text-sm text-ink-secondary">Читаю переписку и расшифровываю голосовые — это 10–30 секунд.</p>}
      {error && <p className="text-sm text-status-critical">{error}</p>}
      {note && !busy && <p className="text-sm text-status-good">{note}</p>}

      {!analysis ? (
        !busy && (
          <p className="text-sm text-ink-secondary">
            {!aiReady
              ? "ИИ ещё не подключён — разбор появится, когда владелец введёт ключ."
              : canRun
                ? hasMessages || waConnected
                  ? "ИИ прочитает переписку в WhatsApp и скажет, что нужно клиенту, о чём договорились, что делать дальше и как прошёл разговор."
                  : "Переписки с этим номером пока нет. Загрузите её из WhatsApp ниже — ИИ сразу разберёт."
                : "Разбора пока нет."}
          </p>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TemperatureChip value={analysis.temperature} />
            <ScoreChip score={analysis.score} />
            {analysis.replyMinutes !== null && (
              <span className="badge bg-surface-sunk text-ink-secondary">отвечаем за {minutesWords(analysis.replyMinutes)}</span>
            )}
            {newMessages > 0 && <span className="badge bg-section-leads-soft text-section-leads">после разбора: {newMessages} нов.</span>}
          </div>

          <p className="text-[15px] leading-relaxed">{analysis.summary}</p>
          {analysis.temperatureWhy && <p className="text-sm text-ink-secondary -mt-2">{analysis.temperatureWhy}</p>}

          <dl className="grid sm:grid-cols-3 gap-3">
            {[
              { label: "Что нужно клиенту", value: analysis.needs },
              { label: "Договорились", value: analysis.agreed },
              { label: "Что делать дальше", value: analysis.nextStep },
            ].map((f) => (
              <div key={f.label} className="rounded-lg bg-surface-plane px-3 py-2 min-w-0">
                <dt className="text-xs text-ink-muted">{f.label}</dt>
                <dd className="text-sm mt-0.5 break-words">{f.value || <span className="text-ink-muted">—</span>}</dd>
              </div>
            ))}
          </dl>

          {(analysis.suggestedStage || prefill) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-section-leads/20 bg-section-leads-soft px-3 py-2">
              <Icon name="arrow" className="w-4 h-4 text-section-leads" />
              <span className="text-sm">
                {analysis.suggestedStage && analysis.suggestedStage !== currentStage
                  ? <>ИИ предлагает стадию <b>{stageLabel(analysis.suggestedStage)}</b>{analysis.suggestedStage === "lost" && analysis.lostReason ? ` (${analysis.lostReason})` : ""}</>
                  : "Стадия по переписке не меняется"}
                {analysis.nextTouchDays !== null && ` · следующее касание через ${analysis.nextTouchDays} дн.`}
              </span>
              {prefill && canRun && (
                <button type="button" className="ml-auto text-sm font-medium text-section-leads hover:underline" onClick={toTouch}>
                  Перенести в касание ↓
                </button>
              )}
            </div>
          )}

          {analysis.objections.length > 0 && (
            <div>
              <div className="text-xs text-ink-muted mb-1">Возражения клиента</div>
              <ul className="space-y-1">
                {analysis.objections.map((o, i) => (
                  <li key={i} className="text-sm">
                    <span className="badge bg-section-claims-soft text-section-claims mr-2">{objectionLabel(o.kind)}</span>
                    {o.quote && <span className="text-ink-secondary">«{o.quote}»</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs text-ink-muted mb-1">Как отработал менеджер</div>
            <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {CHECKLIST.map((c) => {
                const m = analysis.checklist.find((x) => x.key === c.key);
                const mark = MARK[m?.mark ?? "na"];
                return (
                  <li key={c.key} className="flex gap-2 text-sm min-w-0" title={m?.comment || c.hint}>
                    <span className={clsx("w-5 h-5 rounded-full grid place-items-center text-xs flex-none mt-px", mark.cls)}>{mark.sign}</span>
                    <span className="min-w-0">
                      {c.label}
                      {m?.comment && <span className="block text-xs text-ink-muted">{m.comment}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {analysis.advice && (
            <p className="text-sm rounded-lg bg-accent-soft px-3 py-2">
              <b className="text-accent">Совет: </b>
              {analysis.advice}
            </p>
          )}

          <p className="text-xs text-ink-muted">
            Разобрано {formatMoment(analysis.createdAt)} · {analysis.messageCount} сообщ.
            {analysis.createdByEmail === "cron" ? " · автоматически вечером" : ""}. ИИ может ошибаться — решает менеджер.
          </p>
        </div>
      )}

      {canRun && (
        <div className="mt-4">
          <ChatImportForm leadId={leadId} managerName={managerName} aiReady={aiReady} />
        </div>
      )}
    </Section>
  );
}
