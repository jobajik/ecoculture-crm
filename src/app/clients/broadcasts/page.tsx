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
import KpiTile from "@/components/KpiTile";
import BroadcastList, { type BroadcastListRow } from "@/components/BroadcastList";
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

  const sent = broadcasts.reduce((sum, b) => sum + b.totals.sent, 0);
  const replied = broadcasts.reduce((sum, b) => sum + b.totals.replied, 0);
  const orders = broadcasts.reduce((sum, b) => sum + b.results.count, 0);
  const ordersAmount = broadcasts.reduce((sum, b) => sum + b.results.amount, 0);
  const live = broadcasts.filter((b) => b.status === "sending" || b.status === "paused");
  const rows: BroadcastListRow[] = broadcasts.map((b) => ({
    id: b.broadcastId,
    title: b.title,
    when: formatMoment(b.createdAt),
    auto: !!b.auto,
    status: b.status,
    statusLabel: BROADCAST_STATUS_LABELS[b.status] ?? b.status,
    total: b.totals.total,
    sent: b.totals.sent,
    read: b.totals.read,
    replied: b.totals.replied,
    errors: b.totals.errors,
    orders: b.results.count,
    ordersMoney: shortMoney(b.results.amount),
  }));

  return (
    <div>
      <PageHeader
        area="leads"
        title="Рассылки WhatsApp"
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/clients/broadcasts/auto" className="btn-secondary">
              Автопилот
            </Link>
            <Link href="/clients/broadcasts/bot" className="btn-secondary">
              Бот
            </Link>
            <Link href="/clients/broadcasts/photos" className="btn-secondary">
              Фото и каталог
            </Link>
            <Link href="/clients/broadcasts/new" className="btn-primary">
              + Новая рассылка
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="message" label="Рассылок" value={broadcasts.length} hint={live.length > 0 ? `идут сейчас: ${live.length}` : "сейчас ничего не идёт"} tone={live.length > 0 ? "good" : undefined} />
        <KpiTile icon="arrow" label="Отправлено" value={sent.toLocaleString("ru-RU")} hint={optedOut.size > 0 ? `отписались: ${optedOut.size}` : undefined} />
        <KpiTile icon="message" label="Ответили" value={replied.toLocaleString("ru-RU")} hint={sent > 0 ? `${Math.round((replied / sent) * 100)} % от отправленных` : undefined} />
        <KpiTile icon="chart" label="Заявки за 7 дн." value={orders} hint={orders > 0 ? `на ${shortMoney(ordersAmount)}` : "после сообщения"} tone={orders > 0 ? "good" : undefined} />
      </div>

      <div
        className={clsx(
          "rounded-xl px-4 py-3 text-sm mb-5",
          channel.ok ? "bg-status-good/10 text-status-good" : "bg-status-warning/10 text-[#8a5a00]"
        )}
      >
        {channel.text}
      </div>

      <BroadcastList rows={rows} />
    </div>
  );
}
