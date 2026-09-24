/**
 * Изменение к прошлому периоду: «+12 %» зелёным, «−8 %» красным. Когда в
 * прошлом периоде было ноль, процента нет — «рост с нуля» ничего не сообщает,
 * поэтому пишется «новое». Когда нет обоих — пусто.
 */
export default function Change({ now, before }: { now: number; before: number }) {
  if (before <= 0) return now > 0 ? <span className="text-xs text-ink-muted">новое</span> : null;
  const p = ((now - before) / before) * 100;
  if (Math.abs(p) < 0.5) return <span className="text-xs text-ink-muted">0 %</span>;
  return (
    <span className={p > 0 ? "text-status-good" : "text-status-critical"}>
      {p > 0 ? "+" : "−"}
      {Math.round(Math.abs(p))} %
    </span>
  );
}
