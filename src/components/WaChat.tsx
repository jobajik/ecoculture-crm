import clsx from "clsx";
import { messageText, minutesWords } from "@/lib/whatsapp";
import { formatMoment } from "@/lib/formatDate";
import type { WaMessage } from "@/lib/types";
import Section from "./Section";

/**
 * Переписка с лидом в рабочем WhatsApp — пузырями, как в телефоне: клиент
 * слева, мы справа. Свёрнута: открывают, когда нужно перечитать разговор, а
 * главное из него уже стоит выше, в разборе. Видно последние 60 сообщений.
 */
export default function WaChat({
  messages,
  waLink,
  replyMinutes,
  waitingMinutes,
}: {
  messages: WaMessage[];
  waLink: string;
  replyMinutes: number | null;
  waitingMinutes: number | null;
}) {
  const shown = messages.slice(-60);
  return (
    <Section
      tone="leads"
      icon="note"
      title={`Переписка WhatsApp · ${messages.length}`}
      className="!mb-0"
      aside={
        waLink ? (
          <a href={waLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Открыть в WhatsApp
          </a>
        ) : null
      }
    >
      <p className="text-sm text-ink-secondary">
        {waitingMinutes !== null ? (
          <span className="text-status-critical font-medium">Клиент ждёт ответа {minutesWords(waitingMinutes)}. </span>
        ) : null}
        {replyMinutes !== null ? `Обычно отвечаем за ${minutesWords(replyMinutes)}.` : ""}
      </p>
      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted mt-2">Сообщений с этим номером пока нет.</p>
      ) : (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-sm text-accent select-none list-none">
            <span className="group-open:hidden">Показать переписку ›</span>
            <span className="hidden group-open:inline">Скрыть переписку</span>
          </summary>
          {messages.length > shown.length && (
            <p className="text-xs text-ink-muted mt-2">Показаны последние {shown.length} из {messages.length}.</p>
          )}
          <ol className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {shown.map((m) => (
              <li key={m.messageId} className={clsx("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                <div
                  className={clsx(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line break-words",
                    m.direction === "out" ? "bg-accent-soft rounded-br-md" : "bg-surface-plane rounded-bl-md"
                  )}
                >
                  <div className={clsx(m.type !== "text" && "italic text-ink-secondary")}>{messageText(m)}</div>
                  <div className="text-[11px] text-ink-muted mt-0.5 text-right tabular-nums">{formatMoment(m.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Section>
  );
}
