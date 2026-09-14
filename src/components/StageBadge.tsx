"use client";

import clsx from "clsx";
import { STAGE_HINTS, STAGE_LABELS, STAGE_SHORT, STAGE_TONES, type PaymentStage } from "@/lib/paymentStage";

/**
 * Стадия оплаты одной надписью: отметки нет → счёт отправлен → часть → оплачено.
 *
 * Лежит отдельным файлом, а не внутри таблицы оплат, потому что нужен и ей, и
 * клетке отметки о счёте. Держать его в одной из них значило бы завести кольцо
 * импортов между двумя соседними компонентами — оно обычно работает и ровно
 * поэтому опасно: ломается не сразу и не там, где его заводили.
 */
const TONE_CLASS: Record<string, string> = {
  muted: "text-ink-muted bg-surface-plane",
  warning: "text-[#8a5a00] bg-status-warning/10",
  partial: "text-accent bg-accent-soft",
  good: "text-status-good bg-status-good/10",
};

export default function StageBadge({ stage, full = false }: { stage: PaymentStage; full?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-block rounded-md px-2 py-0.5 text-xs whitespace-nowrap",
        TONE_CLASS[STAGE_TONES[stage]]
      )}
      title={STAGE_HINTS[stage]}
    >
      {full ? STAGE_LABELS[stage] : STAGE_SHORT[stage]}
    </span>
  );
}
