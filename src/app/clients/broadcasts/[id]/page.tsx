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
import BroadcastAnalyzeButton from "@/components/BroadcastAnalyzeButton";
import Hint from "@/components/Hint";
import { ORDER_WINDOW_DAYS, REPLY_KINDS, analysisIsStale, kindCounts, type ReplyKind } from "@/lib/broadcastAnalysis";
import { phoneKey } from "@/lib/leads";
import { shortMoney } from "@/lib/formatNumber";
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
  const r = b.results;
  const a = b.analysis;
  const byPhone = new Map(mine.map((v) => [phoneKey(v.phone), v]));
  const kindByPhone = new Map((a?.analysis.people ?? []).map((p) => [phoneKey(p.phone), p]));
  const stale = analysisIsStale(t.replied, a ? a.replies : null);
  const hot = (a?.analysis.people ?? []).filter((p) => p.callFirst);
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

      <Section
        tone="good"
        icon="order"
        title={
          <>
            Заявки за {ORDER_WINDOW_DAYS} дней после сообщения{" "}
            <Hint>
            Заявки получателей, оформленные в течение {ORDER_WINDOW_DAYS} дней после того, как им ушло сообщение. Лид
            считается, если из него уже завели карточку клиента. Это заявки ПОСЛЕ рассылки, а не обязательно ИЗ-ЗА неё:
            постоянный клиент мог заказать и так. Отменённые не считаются.
          </Hint>
          </>
        }
      >
        {r.count === 0 ? (
          <p className="text-sm text-ink-muted">Пока нет.</p>
        ) : (
          <>
            <p className="text-sm">
              <b className="font-display text-xl font-extrabold tabular-nums">{r.count}</b> на{" "}
              <b className="tabular-nums">{shortMoney(r.amount)}</b> · заказали {r.buyers} из {t.sent}
            </p>
            <ul className="mt-2 divide-y divide-line-hairline text-sm">
              {r.orders.slice(0, 10).map((o) => (
                <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <Link href={`/orders/${o.orderId}`} className="text-series-1">
                    {o.clientName || byPhone.get(phoneKey(o.phone))?.name || `+${o.phone}`}
                  </Link>
                  <span className="text-ink-secondary tabular-nums">
                    {formatMoment(o.createdAt)} · {Math.round(o.amount).toLocaleString("ru-RU")} ₸
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section tone="leads" icon="chart" title="Разбор ответов">
        {t.replied === 0 ? (
          <p className="text-sm text-ink-muted">Ответов пока нет — разбирать нечего.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-secondary">
                {a
                  ? `Разобрано ${formatMoment(a.createdAt)} · ответов тогда: ${a.replies}${stale ? ` · с тех пор ответили ещё ${t.replied - a.replies}` : ""}`
                  : `Ответили ${t.replied}. ИИ прочитает переписку и скажет, кому звонить и что поправить.`}
              </p>
              {(!a || stale) && (
                <BroadcastAnalyzeButton broadcastId={b.broadcastId} label={a ? "Обновить разбор" : "Разобрать ответы"} />
              )}
            </div>
            {a && (
              <>
                {a.analysis.summary && <p className="rounded-lg bg-surface-plane px-3 py-2 text-sm">{a.analysis.summary}</p>}
                <div className="flex flex-wrap gap-2 text-xs">
                  {kindCounts(a.analysis).map((k) => (
                    <span key={k.kind} className="rounded-full bg-surface-sunk px-2.5 py-1 text-ink-secondary">
                      {k.label}: <b className="text-ink-primary">{k.count}</b>
                    </span>
                  ))}
                </div>
                {hot.length > 0 && (
                  <div>
                    <div className="label mb-1">Позвонить сегодня</div>
                    <ul className="space-y-1 text-sm">
                      {hot.map((p) => {
                        const v = byPhone.get(phoneKey(p.phone));
                        return (
                          <li key={p.phone}>
                            {v ? (
                              <Link href={v.kind === "lead" ? `/clients/leads/${v.refId}` : `/clients/${v.refId}`} className="text-series-1">
                                {v.name || "Без имени"}
                              </Link>
                            ) : null}{" "}
                            <a href={`tel:+${p.phone}`} className="tabular-nums text-ink-secondary hover:underline">
                              +{p.phone}
                            </a>{" "}
                            — {p.note}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-3 text-sm">
                  {[
                    { title: "Частые вопросы", items: a.analysis.questions },
                    { title: "Возражения и отказы", items: a.analysis.objections },
                    { title: "Что поправить в следующей рассылке", items: a.analysis.advice },
                  ].map((col) => (
                    <div key={col.title}>
                      <div className="label mb-1">{col.title}</div>
                      {col.items.length === 0 ? (
                        <p className="text-ink-muted">—</p>
                      ) : (
                        <ul className="list-disc space-y-1 pl-4">
                          {col.items.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Section>

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
                    {kindByPhone.get(phoneKey(v.phone)) && (
                      <div className="mb-0.5 text-xs font-medium text-series-1">
                        {REPLY_KINDS[kindByPhone.get(phoneKey(v.phone))!.kind as ReplyKind]}
                        {r.byPhone.get(phoneKey(v.phone)) ? " · есть заявка" : ""}
                      </div>
                    )}
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
