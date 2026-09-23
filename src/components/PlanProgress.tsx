import clsx from "clsx";

/**
 * Полоска выполнения плана с отметкой ТЕМПА.
 *
 * «Выполнено 13 %» само по себе ничего не говорит: 13 % пятого числа — норма,
 * 13 % двадцать третьего — провал. Поэтому на полоске стоит вертикальная
 * риска «сколько месяца уже прошло», и цвет заливки считается от неё: догоняем
 * темп — зелёный, чуть отстаём — жёлтый, сильно отстаём — красный. У будущего
 * месяца темпа ещё нет (риска на нуле) — заливка нейтральная.
 *
 * Компонент без состояния: рисуется и на сервере, и в браузере.
 */
export function paceTone(percent: number | null, pace: number): "good" | "warn" | "critical" | "none" {
  if (percent === null) return "none";
  if (pace <= 0) return "good";
  if (percent >= pace - 5) return "good";
  if (percent >= pace - 15) return "warn";
  return "critical";
}

const FILL: Record<string, string> = {
  good: "bg-accent",
  warn: "bg-status-warning",
  critical: "bg-status-critical",
  none: "bg-line-strong",
};

export const TONE_TEXT: Record<string, string> = {
  good: "text-accent",
  warn: "text-[#8a5a00]",
  critical: "text-status-critical",
  none: "text-ink-muted",
};

export default function PlanProgress({
  percent,
  pace,
  size = "md",
  label,
}: {
  /** Выполнение, %; null — плана нет. */
  percent: number | null;
  /** Какая доля месяца прошла, %. */
  pace: number;
  size?: "sm" | "md";
  /** Подпись для экранного диктора. */
  label?: string;
}) {
  const tone = paceTone(percent, pace);
  const width = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div
      className={clsx("relative w-full rounded-full bg-surface-sunk", size === "md" ? "h-2.5" : "h-1.5")}
      role="img"
      aria-label={
        label ??
        (percent === null ? "плана нет" : `выполнено ${Math.round(percent)} %, прошло ${Math.round(pace)} % месяца`)
      }
    >
      <div className={clsx("h-full rounded-full transition-[width]", FILL[tone])} style={{ width: `${width}%` }} />
      {pace > 0 && pace < 100 && (
        <div
          aria-hidden
          className={clsx(
            "absolute top-1/2 -translate-y-1/2 w-0.5 rounded bg-ink-secondary/70",
            size === "md" ? "h-4" : "h-3"
          )}
          style={{ left: `${pace}%` }}
        />
      )}
    </div>
  );
}
