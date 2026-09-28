import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { formatMoment } from "@/lib/formatDate";
import { BROADCAST_STATUS_LABELS } from "@/lib/broadcast";
import { shortMoney } from "@/lib/formatNumber";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import { clientsTabsFor } from "../tabs";
import { channelInfo, loadBroadcastData } from "./data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Клиенты → Рассылки»: WhatsApp через Green API. Только админ и РОП.
 * Правила — `src/lib/broadcast.ts`, действия — `./actions.ts`.
 */
export default async function BroadcastsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  const [{ broadcasts, optedOut }, channel] = await Promise.all([loadBroadcastData(), channelInfo()]);

  return (
    <div className="space-y-6">
      <PageHeader
        area="leads"
        title="Рассылки WhatsApp"
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/clients/broadcasts/bot" className="btn-secondary">
              Бот
            </Link>
            <Link href="/clients/broadcasts/new" className="btn-primary">
              + Новая рассылка
            </Link>
          </div>
        }
      />

      <div
        className={clsx(
          "rounded-xl px-4 py-3 text-sm",
          channel.ok ? "bg-status-good/10 text-status-good" : "bg-status-warning/10 text-[#8a5a00]"
        )}
      >
        {channel.text}
        {optedOut.size > 0 && <span className="text-ink-secondary"> · отписались: {optedOut.size}</span>}
      </div>

      <Section tone="leads" icon="list" title="Все рассылки" flush>
        {broadcasts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-muted">Рассылок ещё не было.</p>
        ) : (
          <div className="table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-3 py-2.5 font-medium">Рассылка</th>
                  <th className="px-3 py-2.5 font-medium">Статус</th>
                  <th className="px-3 py-2.5 font-medium text-right">Кому</th>
                  <th className="px-3 py-2.5 font-medium text-right">Отправлено</th>
                  <th className="px-3 py-2.5 font-medium text-right">Прочитали</th>
                  <th className="px-3 py-2.5 font-medium text-right">Ответили</th>
                  <th className="px-3 py-2.5 font-medium text-right">Ошибки</th>
                  <th className="px-3 py-2.5 font-medium text-right">Заявки за 7 дн.</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr key={b.broadcastId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td className="px-3 py-2.5">
                      <Link href={`/clients/broadcasts/${b.broadcastId}`} className="text-series-1 font-medium">
                        {b.title}
                      </Link>
                      <div className="text-xs text-ink-muted">{formatMoment(b.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2.5" data-label="Статус">
                      {BROADCAST_STATUS_LABELS[b.status] ?? b.status}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Кому">
                      {b.totals.total}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Отправлено">
                      {b.totals.sent}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Прочитали">
                      {b.totals.read}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums text-status-good font-medium" data-label="Ответили">
                      {b.totals.replied}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Ошибки">
                      {b.totals.errors || "—"}
                    </td>
                    <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Заявки за 7 дн.">
                      {b.results.count > 0 ? (
                        <>
                          {b.results.count} <span className="text-ink-muted">· {shortMoney(b.results.amount)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
