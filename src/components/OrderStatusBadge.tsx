import { ORDER_STATUS_LABELS } from "@/lib/constants";
import clsx from "clsx";

const STYLES: Record<string, string> = {
  new: "bg-series-1/10 text-series-1",
  in_progress: "bg-status-warning/15 text-[#8a5a00]",
  ready: "bg-series-3/10 text-series-3",
  shipped: "bg-status-good/10 text-status-good",
  cancelled: "bg-ink-muted/10 text-ink-muted",
};

export default function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("badge", STYLES[status] ?? "bg-ink-muted/10 text-ink-muted")}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}
