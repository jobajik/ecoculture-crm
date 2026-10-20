import Link from "next/link";
import type { DayUser } from "@/lib/myDay/greeting";
import { buildManagerDay, type ManagerDay } from "@/lib/myDay/manager";
import { prefetchTables } from "@/lib/sheets";
import { SHEET_TABS } from "@/lib/constants";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listLeads, listLeadTouches } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { listWaMessages } from "@/lib/repo/talks";
import { listAssistantLog } from "@/lib/repo/waLines";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { listPointDays } from "@/lib/repo/point";
import { visibleLines } from "@/lib/chatAccess";
import { buildChatList, type ChatPartyInfo } from "@/lib/waLines";
import { buildLeadRows, phoneKey } from "@/lib/leads";
import { getLeaderboard } from "@/lib/leaderboard";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import DayCard, { DayEmpty, DayGroup, DayRow } from "./DayCard";
import Pill from "../Pill";
import PlanProgress from "../PlanProgress";

/**
 * «Мой день» менеджера (19.10.2026, макет принят владельцем): кто ждёт ответа в WhatsApp, какие заявки ждут
 * его галочки или без даты, касания лидов на сегодня, как идёт месяц, что за сутки сделал ИИ-помощник.
 * Правила — `src/lib/myDay/manager.ts`; здесь только чтение (одним `prefetchTables`, грабли 1.17) и вид.
 */

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const waitWords = (minutes: number) => (minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ""}`.trim());

async function loadManagerDay(user: DayUser): Promise<ManagerDay> {
  const now = new Date();
  const today = localDayKey(now);
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.WA_LINES,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.LEADS,
    SHEET_TABS.LEAD_TOUCHES,
    SHEET_TABS.ASSISTANT_LOG,
    SHEET_TABS.PLANS,
    SHEET_TABS.POINT_SALES,
  ]);
  const [orders, clients, leads, touches, users, messages, log, lines, plans, pointDays] = await Promise.all([
    listOrdersWithItems(),
    listClients(),
    listLeads(),
    listLeadTouches(),
    listUsers(),
    listWaMessages({ lines: "all" }),
    listAssistantLog(),
    visibleLines(user.role, user.email),
    getPlansForPeriod(today.slice(0, 7)),
    listPointDays().catch(() => []),
  ]);

  // Кто на том конце переписки — как на странице «Переписки»: лид или клиент по любому его номеру.
  const parties = new Map<string, ChatPartyInfo>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (k) parties.set(k, { kind: "lead", id: l.leadId, name: l.name, managerEmail: l.managerEmail });
  }
  for (const c of clients) {
    for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) {
      const k = phoneKey(p);
      if (k) parties.set(k, { kind: "client", id: c.clientId, name: c.name, managerEmail: c.managerEmail });
    }
  }
  for (const u of users) {
    const k = phoneKey(u.phone);
    if (k) parties.set(k, { kind: "staff", id: u.email, name: u.name || u.email, managerEmail: "" });
  }
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const lineCodes = lines.map((l) => l.code);
  const chats = lineCodes.flatMap((code) => buildChatList({ messages, line: code, parties, autoIds, sinceIso: since }));

  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const leadRows = buildLeadRows(leads, touches, nameByEmail, today);
  const board = await getLeaderboard("month", undefined, now, { orders, users, plans, pointDays });
  const leaderboard = board.rows.find((r) => r.managerEmail.toLowerCase() === user.email);

  return buildManagerDay({ email: user.email, today, now, chats, orders, leads: leadRows, leaderboard, assistantLog: log, lineCodes, formatDay });
}

export default async function MyDayManager({ user }: { user: DayUser }) {
  const day = await loadManagerDay(user);
  const own = `&manager=${encodeURIComponent(user.email)}`;
  const m = day.month;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-secondary">{day.summary}</p>

      <div className="grid gap-5 xl:grid-cols-3 items-start">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <DayCard
            tone="leads"
            icon="message"
            title="Ждут ответа в WhatsApp"
            count={day.chats.total}
            countTone={day.chats.total ? "bad" : "muted"}
            link={{ href: "/clients/chats", label: "Все переписки" }}
          >
            {!day.assistant.hasLine && <DayEmpty>Ваш номер WhatsApp ещё не подключён к CRM — попросите администратора подключить его в «Настройках».</DayEmpty>}
            {day.assistant.hasLine && day.chats.rows.length === 0 && <DayEmpty>Никто не ждёт ответа.</DayEmpty>}
            {day.chats.rows.map((c) => (
              <DayRow
                key={`${c.line}:${c.phone}`}
                right={
                  <>
                    <Pill tone={c.long ? "bad" : "wait"}>ждёт {waitWords(c.waitingMinutes)}</Pill>
                    <Link href={c.href} className="btn-primary !h-9 !px-3.5 text-sm">
                      Ответить
                    </Link>
                  </>
                }
              >
                <div className="font-semibold truncate">
                  {c.name} <span className="font-normal text-ink-muted">· {c.who}</span>
                </div>
                <div className="text-[13px] text-ink-secondary truncate">«{c.lastText || "…"}»</div>
              </DayRow>
            ))}
            {day.chats.total > day.chats.rows.length && (
              <DayRow>
                <Link href="/clients/chats" className="text-sm font-semibold text-accent">
                  Ещё {day.chats.total - day.chats.rows.length} →
                </Link>
              </DayRow>
            )}
          </DayCard>

          <DayCard tone="order" icon="order" title="Заявки, где нужен я" link={{ href: `/orders?stage=open${own}`, label: `Все мои заявки · ${day.openOrders}` }}>
            <DayGroup tone={day.waitingMe.total ? "warn" : "muted"}>Ждут моей галочки · {day.waitingMe.total}</DayGroup>
            {day.waitingMe.rows.length === 0 && <DayEmpty>Все заявки подтверждены.</DayEmpty>}
            {day.waitingMe.rows.map((o) => (
              <DayRow
                key={o.orderId}
                right={
                  <>
                    <span className="font-display font-extrabold text-[14px] tabular-nums">{money(o.amount)}</span>
                    <Link href={o.href} className="btn-primary !h-9 !px-3.5 text-sm">
                      Подтвердить
                    </Link>
                  </>
                }
              >
                <div className="truncate">
                  <span className="font-display font-bold text-[13px] text-accent mr-2">№ {o.code}</span>
                  <span className="font-semibold">{o.clientName}</span>
                  <span className="text-ink-muted"> · {o.deliveryLabel} · {o.itemsLabel}</span>
                </div>
              </DayRow>
            ))}
            {day.waitingMe.total > day.waitingMe.rows.length && (
              <DayRow>
                <Link href={`/orders?stage=wait_confirm${own}`} className="text-sm font-semibold text-accent">
                  Ещё {day.waitingMe.total - day.waitingMe.rows.length} →
                </Link>
              </DayRow>
            )}
            <DayGroup tone={day.noDate.total ? "bad" : "muted"}>
              Без даты доставки · {day.noDate.total}
              <span className="normal-case tracking-normal font-normal"> — не попадут в лист сборки</span>
            </DayGroup>
            {day.noDate.rows.length === 0 && <DayEmpty>У всех заявок есть дата.</DayEmpty>}
            {day.noDate.rows.map((o) => (
              <DayRow
                key={o.orderId}
                right={
                  <>
                    <span className="font-display font-extrabold text-[14px] tabular-nums">{money(o.amount)}</span>
                    <Link href={o.href} className="btn-secondary !h-9 !px-3.5 text-sm">
                      Указать дату
                    </Link>
                  </>
                }
              >
                <div className="truncate">
                  <span className="font-display font-bold text-[13px] text-accent mr-2">№ {o.code}</span>
                  <span className="font-semibold">{o.clientName}</span>
                  <span className="text-ink-muted"> · {o.itemsLabel}</span>
                </div>
              </DayRow>
            ))}
          </DayCard>
        </div>

        <div className="space-y-5 min-w-0">
          <DayCard tone="leads" icon="phone" title="Касания сегодня" count={day.leads.total} countTone={day.leads.total ? "wait" : "muted"} link={{ href: "/clients/leads", label: "Лиды" }}>
            {day.leads.rows.length === 0 && <DayEmpty>На сегодня касаний нет.</DayEmpty>}
            {day.leads.rows.map((l) => (
              <DayRow
                key={l.leadId}
                right={
                  <Link href={l.href} className="btn-secondary !h-9 !px-3.5 text-sm">
                    Открыть
                  </Link>
                }
              >
                <div className="font-semibold truncate">
                  {l.name}
                  {l.city && <span className="font-normal text-ink-muted"> · {l.city}</span>}
                </div>
                <div className="text-[13px] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Pill tone={l.overdue ? "bad" : "wait"}>{l.when}</Pill>
                  {l.lastComment && <span className="text-ink-secondary truncate">{l.lastComment}</span>}
                </div>
              </DayRow>
            ))}
          </DayCard>

          <DayCard tone="sales" icon="trophy" title="Мой месяц" flush={false} link={{ href: "/sales", label: "Продажи" }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display font-extrabold text-[24px] tabular-nums">{money(m.sold)}</span>
              <span className="text-xs text-ink-muted">{m.target > 0 ? `план ${money(m.target)}` : "план не задан"}</span>
            </div>
            <div className="mt-2">
              <PlanProgress percent={m.percent} pace={m.pacePercent} />
            </div>
            <div className="mt-1.5 flex justify-between gap-3 text-xs">
              <span
                className={
                  m.tone === "good" ? "text-status-good font-semibold" : m.tone === "warn" ? "text-[#8a5a00] font-semibold" : m.tone === "bad" ? "text-status-critical font-semibold" : "text-ink-muted"
                }
              >
                {m.percent === null ? `${m.orders} заявок за месяц` : `${Math.round(m.percent)} % · ${m.tone === "good" ? "идёте с опережением" : m.tone === "warn" ? "чуть отстаёте" : "отстаёте от темпа"}`}
              </span>
              <span className="text-ink-muted">темп месяца {Math.round(m.pacePercent)} %</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <div className="rounded-xl bg-surface-plane px-3 py-2.5">
                <div className="text-xs text-ink-muted">Бонус заработан</div>
                <div className="font-display font-extrabold text-[17px] tabular-nums">{money(m.bonus)}</div>
              </div>
              <div className="rounded-xl bg-surface-plane px-3 py-2.5">
                <div className="text-xs text-ink-muted">Бонус ждёт оплаты</div>
                <div className="font-display font-extrabold text-[17px] tabular-nums text-[#8a5a00]">{money(m.pendingBonus)}</div>
              </div>
            </div>
          </DayCard>

          {day.assistant.hasLine && (
            <section className="rounded-2xl border border-accent/20 bg-accent-soft px-5 py-4">
              <h2 className="font-display text-[15px] font-bold text-accent-hover">ИИ-помощник за сутки</h2>
              <p className="text-sm mt-1.5 leading-relaxed">
                Ответил клиентам: <strong>{day.assistant.replies}</strong>.
                {day.assistant.orders.length > 0 ? (
                  <>
                    {" "}
                    Оформил {day.assistant.orders.length === 1 ? "заказ" : "заказы"}:{" "}
                    {day.assistant.orders.map((o, i) => (
                      <span key={o.code}>
                        {i > 0 && ", "}
                        <Link href={o.href} className="font-semibold underline-offset-2 hover:underline">
                          № {o.code}
                        </Link>{" "}
                        ({o.clientName}, {money(o.amount)})
                      </span>
                    ))}
                    .
                  </>
                ) : (
                  " Заказов не оформлял."
                )}
                {day.assistant.openNotes > 0 && (
                  <>
                    {" "}
                    Оставил <strong>{day.assistant.openNotes}</strong> {day.assistant.openNotes === 1 ? "записку" : "записки"} — нужен ваш ответ.
                  </>
                )}
              </p>
              <Link href="/clients/chats" className="btn-secondary !h-9 !px-3.5 text-sm mt-3 inline-flex">
                Проверить
              </Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
