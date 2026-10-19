import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { formatMoment } from "@/lib/formatDate";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listBroadcasts, listRecipients, settingsMap } from "@/lib/repo/broadcasts";
import { BROADCAST_STATUS_LABELS, personalize } from "@/lib/broadcast";
import {
  AUTO_PLAN_SETTING,
  AUTO_RULE_HINTS,
  AUTO_RULE_LABELS,
  AUTO_RULES,
  AUTO_SETTING,
  CHAIN_SETTING,
  almatyParts,
  parseAutoConfig,
  parseChainLock,
  parsePlanRecord,
  type AutoRule,
} from "@/lib/autoBroadcast";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import KpiTile from "@/components/KpiTile";
import PaneTabs from "@/components/PaneTabs";
import Hint from "@/components/Hint";
import AutoBroadcastControls from "@/components/AutoBroadcastControls";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECIPIENT_LABELS: Record<string, string> = { queued: "ждёт", sent: "ушло", skipped: "пропущен", error: "ошибка" };
const hm = (iso: string) => {
  if (!iso) return "—";
  const t = almatyParts(new Date(iso));
  return `${String(t.hour).padStart(2, "0")}:${String(t.minutes % 60).padStart(2, "0")}`;
};

/**
 * «Рассылки → Автопилот» (17.10.2026): правила, план на сегодня с текстом каждому, «Остановить сегодня».
 * Правила — `src/lib/autoBroadcast.ts`, работа — `src/lib/autoBroadcastRunner.ts`.
 */
export default async function AutoBroadcastsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS]);
  const [map, broadcasts, recipients] = await Promise.all([settingsMap(), listBroadcasts(), listRecipients()]);
  const cfg = parseAutoConfig(map[AUTO_SETTING]);
  const plan = parsePlanRecord(map[AUTO_PLAN_SETTING]);
  const lock = parseChainLock(map[CHAIN_SETTING]);
  const now = almatyParts(new Date());
  const today = now.day;
  const todays = broadcasts.filter((b) => b.auto && b.plannedFor === today);
  const history = broadcasts.filter((b) => b.auto && b.plannedFor && b.plannedFor < today).slice(0, 20);
  const byBroadcast = new Map<string, typeof recipients>();
  for (const r of recipients) byBroadcast.set(r.broadcastId, [...(byBroadcast.get(r.broadcastId) ?? []), r]);
  const count = (id: string, status?: string) => (byBroadcast.get(id) ?? []).filter((r) => !status || r.status === status).length;

  const planToday = plan.day === today;
  const state = !planToday
    ? now.weekday === 0
      ? "По воскресеньям автопилот отдыхает — план соберётся в понедельник в 9:00."
      : "План на сегодня ещё не собран — соберётся сам в 9:00 и придёт вам в WhatsApp."
    : plan.cancelled
      ? `Сегодня остановлено (${plan.cancelledBy || "вручную"}).`
      : plan.activated
        ? `Идёт отправка (с ${hm(plan.activateAt)}).`
        : plan.ids.length
          ? `План собран в ${hm(plan.at)}, уйдёт с ${hm(plan.activateAt)}. До этого можно остановить — кнопкой ниже или ответом «ОТМЕНА» в WhatsApp.`
          : "Сегодня слать некому.";
  const anyActive = todays.some((b) => b.status === "draft" || b.status === "sending" || b.status === "paused");

  const todayTotal = todays.reduce((sum, b) => sum + count(b.broadcastId), 0);
  const todaySent = todays.reduce((sum, b) => sum + count(b.broadcastId, "sent"), 0);
  const todaySkipped = todays.reduce((sum, b) => sum + count(b.broadcastId, "skipped"), 0);

  return (
    <div>
      <PageHeader
        area="leads"
        title="Автопилот рассылок"
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <Link href="/clients/broadcasts" className="btn-secondary">
            ← Все рассылки
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="list" label="Рассылок сегодня" value={todays.length} hint={planToday ? `план собран в ${hm(plan.at)}` : "план ещё не собран"} />
        <KpiTile icon="client" label="Получателей" value={todayTotal} hint={`правил включено: ${AUTO_RULES.filter((r) => cfg.rules[r]).length} из ${AUTO_RULES.length}`} />
        <KpiTile icon="arrow" label="Ушло сегодня" value={todaySent} hint={todayTotal > 0 ? `${Math.round((todaySent / todayTotal) * 100)} % плана` : undefined} tone={todaySent > 0 ? "good" : undefined} />
        <KpiTile icon="alert" label="Пропущено" value={todaySkipped} hint="написали сами, отписались, дубль" />
      </div>

      <div className="rounded-xl px-4 py-3 text-sm bg-surface-plane mb-5">
        {state}
        {lock.note && <div className="text-xs text-ink-muted mt-1">Отправка: {lock.note.replace(/^\S+ · /, "")}</div>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        <PaneTabs
          boxed
          tabs={[
            {
              key: "today",
              label: "План на сегодня",
              count: todays.length,
              content: (
                <>
                {todays.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-muted">Рассылок автопилота сегодня нет.</p>
                ) : (
                  <div className="divide-y divide-line-hairline">
                    {todays.map((b) => {
                      const list = byBroadcast.get(b.broadcastId) ?? [];
                      return (
                        <div key={b.broadcastId} className="px-4 py-3 space-y-2">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <Link href={`/clients/broadcasts/${b.broadcastId}`} className="text-series-1 font-medium">
                              {AUTO_RULE_LABELS[b.auto as AutoRule] ?? b.title}
                            </Link>
                            <span className="text-sm text-ink-secondary">{b.title.split(" · ").slice(2, -1).join(" · ") || "рабочий номер"}</span>
                            <span className="text-sm">{BROADCAST_STATUS_LABELS[b.status] ?? b.status}</span>
                            <span className="text-sm text-ink-muted tabular-nums">
                              ушло {count(b.broadcastId, "sent")} из {list.length}
                              {count(b.broadcastId, "skipped") ? ` · пропущено ${count(b.broadcastId, "skipped")}` : ""}
                            </span>
                          </div>
                          <details>
                            <summary className="cursor-pointer text-sm text-ink-secondary">Кому и какой текст ({list.length})</summary>
                            <div className="mt-2 space-y-2">
                              {list.map((r) => (
                                <div key={`${r.phone}-${r.rowNumber}`} className="rounded-lg border border-line-hairline p-2 text-sm">
                                  <div className="flex flex-wrap gap-x-3 text-ink-secondary">
                                    <span className="font-medium text-ink-primary">{r.name || "без имени"}</span>
                                    <span className="tabular-nums">…{r.phone.slice(-4)}</span>
                                    <span>{RECIPIENT_LABELS[r.status] ?? r.status}</span>
                                    {r.error && <span className="text-ink-muted">{r.error}</span>}
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[13px]">{personalize(r.text || b.text, r.name, false)}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
              ),
            },
            {
              key: "history",
              label: "Прошлые дни",
              count: history.length,
              content:
                history.length > 0 ? (
                  <div className="table-cards">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-ink-secondary border-b border-line-hairline">
                          <th className="px-3 py-2.5 font-medium">Рассылка</th>
                          <th className="px-3 py-2.5 font-medium">День</th>
                          <th className="px-3 py-2.5 font-medium">Статус</th>
                          <th className="px-3 py-2.5 font-medium text-right">Ушло</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((b) => (
                          <tr key={b.broadcastId} className="border-b border-line-hairline last:border-0">
                            <td className="px-3 py-2.5">
                              <Link href={`/clients/broadcasts/${b.broadcastId}`} className="text-series-1">
                                {b.title}
                              </Link>
                            </td>
                            <td className="px-3 py-2.5" data-label="День">
                              {formatMoment(b.createdAt)}
                            </td>
                            <td className="px-3 py-2.5" data-label="Статус">
                              {BROADCAST_STATUS_LABELS[b.status] ?? b.status}
                            </td>
                            <td className="px-3 py-2.5 sm:text-right tabular-nums" data-label="Ушло">
                              {count(b.broadcastId, "sent")} из {count(b.broadcastId)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null,
            },
          ]}
        />

        <Section
          tone="leads"
          icon="gear"
          title={
            <span className="inline-flex items-center gap-2">
              Правила
              <Hint>
                Каждое утро в 9:00 (пн–сб) сайт собирает план по включённым правилам и присылает его в WhatsApp на номера утренней
                сводки. С 10:00 (и не раньше чем через 45 минут после письма) отправляет сам, без компьютера, с теми же
                паузами, пределами и «сначала тёплым», что и обычные рассылки. Одному человеку — не больше одного сообщения в
                день и не чаще раза в неделю; кому писали или кто писал нам меньше суток назад — не трогаем. Ответ «ОТМЕНА»
                останавливает всё на сегодня.
              </Hint>
            </span>
          }
          className="!mb-0 min-w-0"
        >
          <AutoBroadcastControls
            rules={AUTO_RULES.map((r) => ({ rule: r, label: AUTO_RULE_LABELS[r], hint: AUTO_RULE_HINTS[r], on: cfg.rules[r] }))}
            canStop={anyActive || !planToday}
            canPlan={!(planToday && plan.activated && !plan.cancelled)}
          />
        </Section>
      </div>
    </div>
  );
}
