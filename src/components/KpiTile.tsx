import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/**
 * Плитка с главной цифрой (новый вид по прототипу владельца): подпись со значком, крупное число, строка-пояснение.
 * Пояснение красное, если это повод действовать («5 опаздывают»). Со ссылкой — вся плитка ведёт в отфильтрованный
 * список. Без "use client".
 */
export default function KpiTile({
  icon,
  label,
  value,
  hint,
  tone,
  href,
}: {
  icon?: IconName;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "bad" | "warn" | "good";
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="font-display font-extrabold text-[22px] sm:text-[26px] tabular-nums mt-1.5 leading-none break-words">{value}</div>
      {hint && (
        <div
          className={clsx(
            "text-xs mt-2",
            tone === "bad" ? "text-status-critical font-semibold" : tone === "warn" ? "text-[#8a5a00] font-semibold" : tone === "good" ? "text-status-good font-semibold" : "text-ink-secondary"
          )}
        >
          {hint}
        </div>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="card !p-4 sm:!p-5 block hover:shadow-card-hover transition-shadow">
      {body}
    </Link>
  ) : (
    <div className="card !p-4 sm:!p-5">{body}</div>
  );
}
