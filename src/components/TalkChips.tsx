import clsx from "clsx";
import { minutesWords } from "@/lib/whatsapp";
import { scoreTone, temperatureLabel } from "@/lib/talkAnalysis";

/**
 * Метки переписки у лида: «ждёт ответа 3 ч», «горячий», «оценка 83».
 * Без "use client": рисуют и список лидов (в браузере), и серверные страницы.
 */
export const TEMPERATURE_CHIP: Record<string, string> = {
  hot: "bg-section-claims-soft text-section-claims",
  warm: "bg-status-warning/15 text-[#8a5a00]",
  cold: "bg-surface-sunk text-ink-secondary",
};

const SCORE_CHIP: Record<string, string> = {
  good: "bg-status-good/10 text-status-good",
  warn: "bg-status-warning/15 text-[#8a5a00]",
  bad: "bg-status-critical/10 text-status-critical",
  neutral: "bg-surface-sunk text-ink-secondary",
};

export function TemperatureChip({ value, className }: { value: string; className?: string }) {
  if (!value) return null;
  return <span className={clsx("badge", TEMPERATURE_CHIP[value], className)}>{temperatureLabel(value)}</span>;
}

export function ScoreChip({ score, className }: { score: number | null; className?: string }) {
  if (score === null) return null;
  return (
    <span className={clsx("badge tabular-nums", SCORE_CHIP[scoreTone(score)], className)} title="Оценка работы менеджера по чек-листу">
      оценка {score}
    </span>
  );
}

export function WaitingChip({ minutes, className }: { minutes: number | null; className?: string }) {
  if (minutes === null) return null;
  return (
    <span className={clsx("badge bg-status-critical/10 text-status-critical", className)} title="Последним написал клиент, ответа нет">
      ждёт ответа {minutesWords(minutes)}
    </span>
  );
}
