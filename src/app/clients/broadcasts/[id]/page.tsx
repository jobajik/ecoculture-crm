import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { formatMoment } from "@/lib/formatDate";
import { BROADCAST_STATUS_LABELS, RECIPIENT_STATE_LABELS, type RecipientState } from "@/lib/broadcast";
import { listUsers } from "@/lib/repo/users";
import { publicFileUrl } from "@/lib/waFileSign";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import BroadcastSender from "@/components/BroadcastSender";
import { clientsTabsFor } from "../../tabs";
import { loadBroadcastData } from "../data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATE_TONE: Record<RecipientState, string> = {
  queued: "text-ink-muted",
  skipped: "text-ink-muted",
  error: "text-status-critical",
  sent: "text-ink-secondary",
  delivered: "text-ink-primary",
  read: "text-series-1",
  replied: "text-status-good font-medium",
};

export default async function BroadcastPage({ params, searchParams }: { params: { id: string }; searchParams?: { state?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  const [{ broadcasts, views }, users] = await Promise.all([loadBroadcastData(), listUsers()]);
  const b = broadcasts.find((x) => x.broadcastId === params.id);
  if (!b) notFound();
  const names = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const mine = views.filter((v) => v.broadcastId === b.broadcastId);
  const state = (searchParams?.state || "") as RecipientState | "";
  const list = state ? mine.filter((v) => v.state === state) : mine;
  const t = b.totals;
  const tiles: { key: RecipientState | ""; label: string; value: number }[] = [
    { key: "", label: "Всего", value: t.total },
    { key: "sent", label: "Отправлено", value: t.sent },
    { key: "delivered", label: "Доставлено", value: t.delivered },
    { key: "read", label: "Прочитали", value: t.read },
    { key: "replied", label: "Ответили", value: t.replied },
    { key: "error", label: "Ошибки", value: t.errors },
  ];
  const site = (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

  return (
    <div className="space-y-6">
      <PageHeader
        area="leads"
        title={b.title}
        subtitle={`${BROADCAST_STATUS_LABELS[b.status] ?? b.status} · создана ${formatMoment(b.createdAt)}${b.audience ? ` · ${b.audience}` : ""}`}
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <Link href="/clients/broadcasts" className="text-sm text-ink-secondary hover:underline">
            ← все рассылки
          </Link>
        }
      />

      <BroadcastSender broadcastId={b.broadcastId} status={b.status} remaining={t.queued} note={b.note} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.key ? `?state=${tile.key}` : "?"}
            className={clsx("card !py-3 hover:border-accent", state === tile.key && "ring-2 ring-accent")}
          >
            <div className="text-xs text-ink-secondary">{tile.label}</div>
            <div className="font-display text-2xl font-extrabold tabular-nums">{tile.value}</div>
            {tile.key && t.sent > 0 && tile.key !== "sent" && (
              <div className="text-xs text-ink-muted">{Math.round((tile.value / t.sent) * 100)} % от отправленных</div>
            )}
          </Link>
        ))}
      </div>
      {t.optedOut > 0 && <p className="text-sm text-ink-secondary">После рассылки отписались: {t.optedOut}.</p>}

      <Section tone="leads" icon="note" title="Сообщение">
        {b.fileId && (
          <p className="mb-2 text-sm">
            Файл:{" "}
            <a href={publicFileUrl(site, b.fileId, b.fileName)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {b.fileName}
            </a>
          </p>
        )}
        <div className="whitespace-pre-wrap rounded-lg bg-surface-plane px-3 py-2 text-sm">{b.text || "—"}</div>
      </Section>

      <Section tone="leads" icon="list" title={state ? `${RECIPIENT_STATE_LABELS[state]}: ${list.length}` : `Получатели: ${list.length}`} flush>
        <div className="table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-3 py-2.5 font-medium">Кому</th>
                <th className="px-3 py-2.5 font-medium">Менеджер</th>
                <th className="px-3 py-2.5 font-medium">Итог</th>
                <th className="px-3 py-2.5 font-medium">Ответ</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 500).map((v) => (
                <tr key={`${v.phone}-${v.refId}`} className="border-b border-line-hairline last:border-0 align-top">
                  <td className="px-3 py-2">
                    <Link
                      href={v.kind === "lead" ? `/clients/leads/${v.refId}` : `/clients/${v.refId}`}
                      className="text-series-1"
                    >
                      {v.name || "Без имени"}
                    </Link>
                    <div className="text-xs text-ink-muted tabular-nums">+{v.phone}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-secondary" data-label="Менеджер">
                    {v.managerEmail ? names.get(v.managerEmail.toLowerCase()) ?? v.managerEmail : "—"}
                  </td>
                  <td className={clsx("px-3 py-2", STATE_TONE[v.state])} data-label="Итог">
                    {RECIPIENT_STATE_LABELS[v.state]}
                    {v.error && <div className="text-xs text-status-critical">{v.error}</div>}
                    {v.sentAt && <div className="text-xs text-ink-muted">{formatMoment(v.sentAt)}</div>}
                  </td>
                  <td className="px-3 py-2" data-label="Ответ">
                    {v.replyText ? (
                      <>
                        <div className="line-clamp-2 max-w-[360px]">{v.replyText}</div>
                        <div className="text-xs text-ink-muted">{formatMoment(v.replyAt)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 500 && <p className="px-3 py-2 text-xs text-ink-muted">Показаны первые 500 из {list.length}.</p>}
        </div>
      </Section>
    </div>
  );
}
