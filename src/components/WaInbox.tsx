import Link from "next/link";
import { formatMoment } from "@/lib/formatDate";
import { prettyWaPhone, type InboxRow } from "@/lib/whatsapp";
import Section from "./Section";

/**
 * «Написали в WhatsApp»: номера, которых нет ни у лида, ни у клиента, а человек
 * сам написал на рабочий номер. Это готовые лиды — «Завести лидом» открывает
 * форму уже с номером и именем. Первые 8, остальное под «ещё».
 */
export default function WaInbox({ rows }: { rows: InboxRow[] }) {
  if (rows.length === 0) return null;
  const first = rows.slice(0, 8);
  const rest = rows.slice(8);
  const row = (r: InboxRow) => {
    const params = new URLSearchParams({ new: "1", phone: prettyWaPhone(r.phone), name: r.name || "", source: "Написали в WhatsApp" });
    return (
      <li key={r.phone} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm min-w-0">
        <span className="font-medium">{r.name || prettyWaPhone(r.phone)}</span>
        {r.name && <span className="text-xs text-ink-muted tabular-nums">{prettyWaPhone(r.phone)}</span>}
        {r.waiting && <span className="badge bg-status-critical/10 text-status-critical">ждёт ответа</span>}
        <span className="basis-full sm:basis-auto sm:flex-1 min-w-0 truncate text-ink-secondary" title={r.lastText}>
          {r.lastText}
        </span>
        <span className="text-xs text-ink-muted tabular-nums">{formatMoment(r.lastAt)}</span>
        <Link href={`/clients/leads?${params.toString()}`} className="text-accent font-medium hover:underline whitespace-nowrap">
          Завести лидом
        </Link>
      </li>
    );
  };
  return (
    <Section tone="leads" icon="phone" title={`Написали в WhatsApp · ${rows.length}`} flush className="!mb-0">
      <ol className="divide-y divide-line-hairline/70 border-t border-line-hairline">{first.map(row)}</ol>
      {rest.length > 0 && (
        <details className="border-t border-line-hairline">
          <summary className="cursor-pointer px-4 py-2 text-sm text-accent select-none">ещё {rest.length}</summary>
          <ol className="divide-y divide-line-hairline/70">{rest.map(row)}</ol>
        </details>
      )}
    </Section>
  );
}
