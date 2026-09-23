import clsx from "clsx";
import { lateLabel, type OrderStage } from "@/lib/orderStage";

/**
 * Этап заявки — одним и тем же словом и цветом во всех списках (`orderStage`).
 *
 * Цвета несут смысл, а не украшают: жёлтый — ждём кого-то, зелёный акцент —
 * дело за складом, спокойный зелёный — закрыта, серый — отменена. Красной
 * бывает только метка опоздания: она одна и должна бросаться в глаза.
 * Компонент без состояния — его рисуют и серверные страницы, и клиентские.
 */
const TONE: Record<OrderStage["tone"], string> = {
  wait: "bg-status-warning/15 text-[#8a5a00]",
  ready: "bg-accent-soft text-accent",
  done: "bg-status-good/10 text-status-good",
  muted: "bg-ink-muted/10 text-ink-muted",
};

export default function OrderStageBadge({
  stage,
  showActor = false,
  compact = false,
}: {
  stage: OrderStage;
  /** Подписать, чей ход («· менеджер»). */
  showActor?: boolean;
  /** Опоздание короче — для узких колонок. */
  compact?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={clsx("badge whitespace-nowrap", TONE[stage.tone])}>
        {stage.label}
        {showActor && stage.actor ? <span className="opacity-70 font-normal"> · {stage.actor}</span> : null}
      </span>
      {stage.lateDays > 0 && (
        <span className="badge whitespace-nowrap bg-status-critical/10 text-status-critical" title={lateLabel(stage.lateDays)}>
          {compact ? `опоздание ${stage.lateDays} дн.` : lateLabel(stage.lateDays)}
        </span>
      )}
    </span>
  );
}
