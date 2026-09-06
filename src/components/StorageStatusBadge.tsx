import { STORAGE_STATUS_LABELS, type StorageStatus } from "@/lib/shelfLife";
import clsx from "clsx";

const STYLES: Record<StorageStatus, string> = {
  ok: "bg-status-good/10 text-status-good",
  warning: "bg-status-warning/20 text-[#8a5a00]",
  critical: "bg-status-critical/10 text-status-critical",
  depleted: "bg-ink-muted/10 text-ink-muted",
};

const ICONS: Record<StorageStatus, string> = {
  ok: "✓",
  warning: "⚠",
  critical: "⛔",
  depleted: "—",
};

export default function StorageStatusBadge({ status }: { status: StorageStatus }) {
  return (
    <span className={clsx("badge", STYLES[status])}>
      <span aria-hidden>{ICONS[status]}</span>
      {STORAGE_STATUS_LABELS[status]}
    </span>
  );
}
