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
import { isSpecialFile, specialFileLabel } from "@/lib/botPhotos";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import BroadcastSender from "@/components/BroadcastSender";
import BroadcastAnalyzeButton from "@/components/BroadcastAnalyzeButton";
import Hint from "@/components/Hint";
import KpiTile from "@/components/KpiTile";
import PaneTabs from "@/components/PaneTabs";
import PagedList from "@/components/PagedList";
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

  const pctOf = (v: number) => (t.sent > 0 ? `${Math.round((v / t.sent) * 100)} % от отправленных` : undefined);
  const recipientRows = list.map((v) => {
    const kind = kindByPhone.get(phoneKey(v.phone));
    return (
      <li key={`${v.phone}-${v.refId}`} className="px-4 py-2.5 grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_130px_150px_minmax(0,1.3fr)] text-sm items-start">
        <div className="min-w-0">
          <Link href={v.kind === "lead" ? `/clients/leads/${v.refId}` : `/clients/${v.refId}`} className="font-medium hover:underline">
            {v.name || "Без имени"}
          </Link>
          <div className="text-xs text-ink-muted tabular-nums">+{v.phone}</div>
        </div>
        <div className="text-ink-secondary truncate">{v.managerEmail ? names.get(v.managerEmail.toLowerCase()) ?? v.managerEmail : "—"}</div>
        <div className={STATE_TONE[v.state]}>
          {RECIPIENT_STATE_LABELS[v.state]}
          {v.error && <div className="text-xs text-status-critical">{v.error}</div>}
          {v.sentAt && <div className="text-xs text-ink-muted">{formatMoment(v.sentAt)}</div>}
        </div>
        <div className="min-w-0">
          {kind && (
            <div className="mb-0.5 text-xs font-medium text-series-1">
              {REPLY_KINDS[kind.kind as ReplyKind]}
              {r.byPhone.get(phoneKey(v.phone)) ? " · есть заявка" : ""}
            </div>
          )}
          {v.replyText ? (
            <>
              <div className="line-clamp-2 break-words">{v.replyText}</div>
              <div className="text-xs text-ink-muted">{formatMoment(v.replyAt)}</div>
            </>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </div>
      </li>
    );
  });

  return (
    <div>
      <PageHeader
        area="leads"
        title={b.title}
        subtitle={`${BROADCAST_STATUS_LABELS[b.status] ?? b.status} · создана ${formatMoment(b.createdAt)}${b.audience ? ` · ${b.audience}` : ""}`}
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <Link href="/clients/broadcasts" className="btn-secondary">
            ← Все рассылки
          </Link>
        }
      />

      <div className="mb-5">
        <BroadcastSender broadcastId={b.broadcastId} status={b.status} remaining={t.queued} note={b.note} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="arrow" label="Отправлено" value={`${t.sent} из ${t.total}`} hint={t.queued > 0 ? `в очереди: ${t.queued}` : t.errors > 0 ? `ошибок: ${t.errors}` : "очередь пуста"} tone={t.errors > 0 && t.queued === 0 ? "bad" : undefined} />
        <KpiTile icon="check" label="Прочитали" value={t.read} hint={pctOf(t.read) ?? `доставлено: ${t.delivered}`} />
        <KpiTile icon="message" label="Ответили" value={t.replied} hint={t.optedOut > 0 ? `отписались: ${t.optedOut}` : pctOf(t.replied)} tone={t.replied > 0 ? "good" : undefined} />
        <KpiTile icon="order" label={`Заявки за ${ORDER_WINDOW_DAYS} дн.`} value={r.count} hint={r.count > 0 ? `на ${shortMoney(r.amount)} · заказали ${r.buyers}` : "после сообщения"} tone={r.count > 0 ? "good" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <PaneTabs
          boxed
          tabs={[
            {
              key: "people",
              label: "Получатели",
              count: mine.length,
              content: (
                <>
                  <div className="px-4 py-3 border-b border-line-hairline flex gap-2 overflow-x-auto scroll-x-hidden lg:flex-wrap">
                    {tiles.map((tile) => (
                      <Link
                        key={tile.label}
                        href={tile.key ? `?state=${tile.key}` : "?"}
                        className={clsx(
                          "flex-none h-8 px-3 rounded-full border text-[13px] whitespace-nowrap inline-flex items-center gap-1.5 transition-colors",
                          state === tile.key ? "bg-ink-primary border-ink-primary text-white" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
                        )}
                      >
                        {tile.label}
                        <b className={clsx("font-semibold tabular-nums", state !== tile.key && tile.key === "error" && tile.value > 0 && "text-status-critical")}>{tile.value}</b>
                      </Link>
                    ))}
                  </div>
                  {list.length > 0 && (
                    <div className="hidden lg:grid px-4 py-2 border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted gap-x-4 grid-cols-[minmax(0,1fr)_130px_150px_minmax(0,1.3fr)]">
                      <span>Кому</span>
                      <span>Менеджер</span>
                      <span>Итог</span>
                      <span>Ответ</span>
                    </div>
                  )}
                  <PagedList
                    items={recipientRows}
                    what="получателей"
                    resetKey={state}
                    empty={<p className="px-4 py-6 text-sm text-ink-muted">Никого.</p>}
                  />
                </>
              ),
            },
            {
              key: "analysis",
              label: "Разбор ответов",
              alert: stale,
              content: (
                <div className="p-4 sm:p-5">
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
                          <div className="grid gap-4 lg:grid-cols-3 text-sm">
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
                </div>
              ),
            },
          ]}
        />

        <div className="space-y-5 min-w-0">
          <Section tone="leads" icon="note" title="Сообщение" className="!mb-0">
            {b.fileId && isSpecialFile(b.fileId) && <p className="mb-2 text-sm">Вложение: {specialFileLabel(b.fileId)}</p>}
            {b.fileId && !isSpecialFile(b.fileId) && (
              <p className="mb-2 text-sm">
                Файл:{" "}
                <a href={publicFileUrl(site, b.fileId, b.fileName)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {b.fileName}
                </a>
              </p>
            )}
            <div className="whitespace-pre-wrap rounded-lg bg-surface-plane px-3 py-2 text-sm">{b.text || "—"}</div>
          </Section>

          <Section
            tone="good"
            icon="order"
            className="!mb-0"
            title={
              <>
                Заявки после сообщения{" "}
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
                  {r.orders.slice(0, 8).map((o) => (
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
                {r.orders.length > 8 && <p className="text-xs text-ink-muted mt-1">и ещё {r.orders.length - 8}</p>}
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
