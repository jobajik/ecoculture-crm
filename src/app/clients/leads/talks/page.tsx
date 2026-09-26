import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prefetchTables } from "@/lib/sheets";
import { ROLES, SHEET_TABS } from "@/lib/constants";
import { listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { listLeadAnalyses, listWaMessages } from "@/lib/repo/talks";
import { canManageLeads, canSeeLead, canUseLeads } from "@/lib/leads";
import { CHECKLIST, buildTalkReport, talkInfoByLead, type TalkLeadInfo } from "@/lib/talkAnalysis";
import { minutesSince, minutesWords } from "@/lib/whatsapp";
import { greenConfig } from "@/lib/greenApi";
import { openAiConfigured } from "@/lib/openai";
import { formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import StatTile from "@/components/StatTile";
import Hint from "@/components/Hint";
import TalksRunButton from "@/components/TalksRunButton";
import { ScoreChip, TemperatureChip } from "@/components/TalkChips";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PERIOD_DAYS = 30;

/**
 * «Лиды → Разговоры»: что показала переписка WhatsApp за 30 дней. Кто ждёт
 * ответа, кто горячий, как работают менеджеры по чек-листу и что чаще всего
 * мешает продаже. Менеджер видит свои лиды и ничьи, РОП и админ — всех.
 */
export default async function TalksPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!canUseLeads(role)) redirect("/?error=forbidden");
  const email = (session?.user?.email ?? "").toLowerCase();
  const manage = canManageLeads(role);

  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.USERS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES]);
  const [leads, users, messages, analyses] = await Promise.all([listLeads(), listUsers(), listWaMessages(), listLeadAnalyses()]);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const visible = leads.filter((l) => canSeeLead(role, email, l));
  const infos = Array.from(talkInfoByLead(visible, messages, analyses).values());
  const now = new Date();
  const report = buildTalkReport(infos, nameByEmail, now, PERIOD_DAYS);

  const waReady = !!greenConfig();
  const aiReady = openAiConfigured();
  const scored = report.managers.filter((m) => m.avgScore !== null);
  const teamScore = scored.length
    ? Math.round(scored.reduce((s, m) => s + (m.avgScore ?? 0) * m.analysed, 0) / Math.max(1, scored.reduce((s, m) => s + m.analysed, 0)))
    : null;
  // Чек-лист по команде: доля «да» по каждому пункту среди всех свежих разборов.
  const since = new Date(now.getTime() - PERIOD_DAYS * 86400000).toISOString();
  const fresh = infos.map((i) => i.analysis).filter((a) => a && a.createdAt >= since);
  const team = CHECKLIST.map((c) => {
    const marks = fresh.flatMap((a) => a!.checklist.filter((m) => m.key === c.key && m.mark !== "na"));
    return { ...c, total: marks.length, pct: marks.length ? Math.round((marks.filter((m) => m.mark === "yes").length / marks.length) * 100) : null };
  });
  const maxObjection = Math.max(1, ...report.objections.map((o) => o.count));
  const who = (e: string) => (e ? nameByEmail.get(e) ?? e : "ничей");

  const leadLine = (i: TalkLeadInfo, extra: React.ReactNode) => (
    <li key={i.leadId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm min-w-0">
      <Link href={`/clients/leads/${i.leadId}`} className="font-medium hover:underline">
        {i.name}
      </Link>
      <span className="text-xs text-ink-muted">{who(i.managerEmail)}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1">{extra}</span>
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        area="leads"
        title="Разговоры"
        icon="chart"
        tabs={clientsTabsFor()}
        subtitle={
          <>
            Переписка с лидами в рабочем WhatsApp за {PERIOD_DAYS} дней
            <span className="font-sans">
              <Hint>
                Сообщения приходят сами из рабочего номера. ИИ разбирает переписку по кнопке в карточке лида и каждый вечер
                сам — тех, где появились новые сообщения. Оценка менеджера — доля выполненных пунктов чек-листа среди тех,
                что были к месту. ИИ может ошибаться: решает менеджер.
              </Hint>
            </span>
          </>
        }
        actions={manage && waReady && aiReady ? <TalksRunButton pending={report.stale.length} /> : undefined}
      />

      {(!waReady || !aiReady) && (
        <Section tone="warn" icon="alert" title="Подключение" className="!mb-0">
          <ul className="text-sm space-y-1">
            <li>
              WhatsApp рабочего номера: {waReady ? <b className="text-status-good">подключён</b> : <b className="text-[#8a5a00]">не подключён</b>}
            </li>
            <li>
              ИИ (OpenAI): {aiReady ? <b className="text-status-good">подключён</b> : <b className="text-[#8a5a00]">не подключён</b>}
            </li>
          </ul>
          <p className="text-sm text-ink-secondary mt-2">
            {role === ROLES.ADMIN
              ? "Ключи вводятся двойным щелчком по whatsapp-key.bat в папке программы — инструкция у Claude."
              : "Подключает владелец; пока этого нет, разборов не будет."}
          </p>
        </Section>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Разобрано за 30 дней" value={String(report.analysedTotal)} sub={`переписок с сообщениями: ${infos.filter((i) => i.messages > 0).length}`} />
        <StatTile
          label="Средняя оценка"
          value={teamScore === null ? "—" : String(teamScore)}
          sub="из 100 по чек-листу"
          tone={teamScore === null ? "default" : teamScore >= 80 ? "good" : teamScore >= 50 ? "warning" : "critical"}
        />
        <StatTile
          label="Ждут ответа"
          value={String(report.waiting.length)}
          sub="клиент написал, мы молчим больше часа"
          tone={report.waiting.length > 0 ? "critical" : "default"}
        />
        <StatTile label="Горячие" value={String(report.hot.length)} sub="готовы заказать" tone={report.hot.length > 0 ? "good" : "default"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Section tone={report.waiting.length ? "bad" : "neutral"} icon="clock" title={`Ждут ответа · ${report.waiting.length}`} flush className="!mb-0">
          {report.waiting.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-muted">Все, кто написал, получили ответ.</p>
          ) : (
            <ol className="divide-y divide-line-hairline/70 border-t border-line-hairline">
              {report.waiting.map((i) =>
                leadLine(
                  i,
                  <span className="badge bg-status-critical/10 text-status-critical">{minutesWords(minutesSince(i.waitingSince, now))}</span>
                )
              )}
            </ol>
          )}
        </Section>

        <Section tone="claims" icon="arrow" title={`Горячие · ${report.hot.length}`} flush className="!mb-0">
          {report.hot.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-muted">Горячих лидов по последним разборам нет.</p>
          ) : (
            <ol className="divide-y divide-line-hairline/70 border-t border-line-hairline">
              {report.hot.map((i) =>
                leadLine(
                  i,
                  <>
                    <TemperatureChip value="hot" />
                    <span className="text-xs text-ink-muted tabular-nums">{i.lastAt ? formatMoment(i.lastAt) : ""}</span>
                  </>
                )
              )}
            </ol>
          )}
        </Section>
      </div>

      <Section tone="leads" icon="client" title="Менеджеры" flush className="!mb-0">
        {report.managers.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-ink-muted">Переписок с лидами пока нет.</p>
        ) : (
          <div className="table-cards border-t border-line-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2 font-medium">Менеджер</th>
                  <th className="px-3 py-2 font-medium text-right">Разборов</th>
                  <th className="px-3 py-2 font-medium text-right">Оценка</th>
                  <th className="px-3 py-2 font-medium text-right">Отвечает за</th>
                  <th className="px-3 py-2 font-medium text-right">Ждут ответа</th>
                  <th className="px-3 py-2 font-medium text-right">Горячих</th>
                  <th className="px-4 py-2 font-medium">Слабее всего</th>
                </tr>
              </thead>
              <tbody>
                {report.managers.map((m) => {
                  const weak = CHECKLIST.map((c) => ({ label: c.label as string, pct: m.items[c.key] }))
                    .filter((x): x is { label: string; pct: number } => x.pct !== null && x.pct < 70)
                    .sort((a, b) => a.pct - b.pct)
                    .slice(0, 2);
                  return (
                    <tr key={m.email || "free"} className="border-b border-line-hairline/70 last:border-0">
                      <td className="px-4 py-2 font-medium">{m.name}</td>
                      <td data-label="Разборов" className="px-3 py-2 text-right tabular-nums">{m.analysed || ""}</td>
                      <td data-label="Оценка" className="px-3 py-2 text-right">
                        <ScoreChip score={m.avgScore} />
                      </td>
                      <td data-label="Отвечает за" className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {m.replyMinutes === null ? "" : minutesWords(m.replyMinutes)}
                      </td>
                      <td data-label="Ждут ответа" className={`px-3 py-2 text-right tabular-nums ${m.waiting ? "text-status-critical font-medium" : ""}`}>
                        {m.waiting || ""}
                      </td>
                      <td data-label="Горячих" className="px-3 py-2 text-right tabular-nums">{m.hot || ""}</td>
                      <td data-label="Слабее всего" className="px-4 py-2 text-ink-secondary">
                        {weak.map((w) => `${w.label} — ${w.pct} %`).join("; ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Section tone="leads" icon="check" title="Чек-лист по команде" className="!mb-0">
          {fresh.length === 0 ? (
            <p className="text-sm text-ink-muted">Разборов за {PERIOD_DAYS} дней пока нет.</p>
          ) : (
            <ul className="space-y-2.5">
              {team.map((c) => (
                <li key={c.key} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span title={c.hint}>{c.label}</span>
                    <span className="tabular-nums text-ink-secondary">{c.pct === null ? "не к месту" : `${c.pct} %`}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-sunk mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.pct === null ? "" : c.pct >= 80 ? "bg-status-good" : c.pct >= 50 ? "bg-status-warning" : "bg-status-critical"}`}
                      style={{ width: `${c.pct ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section tone="claims" icon="alert" title="Что мешает продаже" className="!mb-0">
          {report.objections.length === 0 ? (
            <p className="text-sm text-ink-muted">Возражений в разборах за {PERIOD_DAYS} дней нет.</p>
          ) : (
            <ul className="space-y-2.5">
              {report.objections.map((o) => (
                <li key={o.kind} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{o.label}</span>
                    <span className="tabular-nums text-ink-secondary">{o.count} лид.</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-sunk mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-section-claims" style={{ width: `${(o.count / maxObjection) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
