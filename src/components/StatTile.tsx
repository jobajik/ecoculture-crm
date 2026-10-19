export default function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warning" | "critical";
}) {
  const toneClass =
    tone === "good"
      ? "text-status-good"
      : tone === "warning"
      ? "text-[#8a5a00]"
      : tone === "critical"
      ? "text-status-critical"
      : "text-ink-primary";

  return (
    <div className="card !p-4 sm:!p-5">
      <div className="text-xs text-ink-muted mb-1.5">{label}</div>
      <div className={`font-display text-[22px] sm:text-[26px] leading-none font-extrabold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-ink-secondary mt-2">{sub}</div>}
    </div>
  );
}
