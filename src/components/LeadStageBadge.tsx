import clsx from "clsx";
import { stageLabel } from "@/lib/leads";

/**
 * Стадия лида словом. Цвет — только у «Пробный заказ», «Постоянный» (успех) и
 * «Отказ»: рабочие стадии одного тона, иначе список пестрит и перестаёт
 * показывать главное — просроченные касания.
 */
const TONE: Record<string, string> = {
  trial: "bg-status-good/15 text-status-good",
  regular: "bg-status-good/20 text-status-good font-medium",
  lost: "bg-surface-sunk text-ink-muted",
};

export default function LeadStageBadge({ stage }: { stage: string }) {
  return (
    <span className={clsx("inline-block rounded-full px-2 py-0.5 text-xs", TONE[stage] ?? "bg-accent/10 text-accent")}>
      {stageLabel(stage)}
    </span>
  );
}
