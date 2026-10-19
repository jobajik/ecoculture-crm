import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Метка состояния с точкой (новый вид, 19.10.2026): зелёная — хорошо, жёлтая — ждём, красная — плохо, серая — без
 * оценки. Цвет здесь значит только состояние, а не раздел. Без "use client".
 */
export type PillTone = "good" | "wait" | "bad" | "muted";

const TONE: Record<PillTone, string> = {
  good: "bg-status-good/10 text-[#157a4b]",
  wait: "bg-status-warning/15 text-[#8a5a00]",
  bad: "bg-status-critical/10 text-status-critical",
  muted: "bg-surface-sunk text-ink-secondary",
};

export default function Pill({ tone, children, dot = true }: { tone: PillTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE[tone])}>
      {dot && tone !== "muted" && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
