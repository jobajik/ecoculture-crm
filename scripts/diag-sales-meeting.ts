import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Цифры к разговору о продажах (15.10.2026, голосовое: «как мы работаем со старой базой и с людьми из рекламы,
 * правило 5 касаний, бот — выжимаем ли до конца, напоминания клиентам о себе»). Ничего не меняет.
 * Печатает текст и кладёт JSON в _private/sales-meeting.json.
 *   npx tsx scripts/diag-sales-meeting.ts
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listLeadTouches, listLeads } from "../src/lib/repo/leads";
import { listUsers } from "../src/lib/repo/users";
import { listWaMessages } from "../src/lib/repo/talks";
import { listBotChats, listBroadcasts, listRecipients, listWaStatuses } from "../src/lib/repo/broadcasts";
import { deliveryByMessage } from "../src/lib/broadcast";
import { isNotASale } from "../src/lib/orderKind";
import { adsManagerTouches, isClosedStage, phoneKey } from "../src/lib/leads";
import { BOT_MANAGER_EMAIL } from "../src/lib/botIdentity";
import { CALL_OUTCOMES } from "../src/lib/calls";
import { localDayKey } from "../src/lib/timezone";
import { ORDER_STATUSES } from "../src/lib/constants";

const day = (iso: string) => (iso || "").slice(0, 10);
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const bucket = (n: number) => (n >= 5 ? "5+" : String(n));
const BUCKETS = ["0", "1", "2", "3", "4", "5+"];

async function main() {
  const today = localDayKey();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.USERS]);
  const [orders, clients, leads, touches, users, msgs, broadcasts, recipients, statuses, botChats] = await Promise.all([
    listOrdersWithItems(),
    listClients(),
    listLeads(),
    listLeadTouches(),
    listUsers(),
    listWaMessages({ lines: "all" }),
    listBroadcasts(),
    listRecipients(),
    listWaStatuses(),
    listBotChats(),
  ]);
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  name.set(BOT_MANAGER_EMAIL, "Бот WhatsApp");
  const out: Record<string, unknown> = { today };
  const P = (s = "") => console.log(s);

  // ---- 1. Продажи по неделям ---------------------------------------------------------
  const sales = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && o.clientId);
  const firstOrder = new Map<string, string>();
  for (const o of [...sales].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) if (!firstOrder.has(o.clientId)) firstOrder.set(o.clientId, day(o.createdAt));
  P("=== 1. Продажи по неделям (без отмен, магазинов, опта на город, пожарки) ===");
  const weeks: unknown[] = [];
  for (let w = 5; w >= 0; w--) {
    const from = addDays(today, -7 * w - 6);
    const to = addDays(today, -7 * w);
    const inW = sales.filter((o) => day(o.createdAt) >= from && day(o.createdAt) <= to);
    const cl = new Set(inW.map((o) => o.clientId));
    const fresh = Array.from(cl).filter((c) => (firstOrder.get(c) || "") >= from).length;
    const bot = inW.filter((o) => o.managerEmail === BOT_MANAGER_EMAIL);
    const sum = inW.reduce((s, o) => s + o.totalAmount, 0);
    weeks.push({ from, to, orders: inW.length, sum, clients: cl.size, newClients: fresh, botOrders: bot.length, botSum: bot.reduce((s, o) => s + o.totalAmount, 0) });
    P(`${from}…${to}: заявок ${inW.length}, ${money(sum)}, клиентов ${cl.size} (новых ${fresh}); бот: ${bot.length} на ${money(bot.reduce((s, o) => s + o.totalAmount, 0))}`);
  }
  out.weeks = weeks;

  // ---- 2. Старая база (обзвон) -------------------------------------------------------
  P("\n=== 2. Старая база (обзвон) ===");
  const touchesBy = new Map<string, typeof touches>();
  for (const t of touches) touchesBy.set(t.leadId, [...(touchesBy.get(t.leadId) ?? []), t]);
  const clientById = new Map(clients.map((c) => [c.clientId, c]));
  const salesByClient = new Map<string, typeof sales>();
  for (const o of sales) salesByClient.set(o.clientId, [...(salesByClient.get(o.clientId) ?? []), o]);
  const campaigns = Array.from(new Set(leads.filter((l) => l.campaign).map((l) => l.campaign)));
  const camp: unknown[] = [];
  for (const c of campaigns) {
    const ls = leads.filter((l) => l.campaign === c);
    const dist: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    const lastOutcome: Record<string, number> = {};
    let reached = 0;
    let won = 0;
    let wonSum = 0;
    let open = 0;
    let overdue = 0;
    let noNext = 0;
    for (const l of ls) {
      const ts = touchesBy.get(l.leadId) ?? [];
      dist[bucket(ts.length)]++;
      const calls = ts.filter((t) => t.outcome).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const last = calls[calls.length - 1];
      if (last) lastOutcome[last.outcome] = (lastOutcome[last.outcome] ?? 0) + 1;
      if (calls.some((t) => t.outcome !== "no_answer" && t.outcome !== "wrong_number")) reached++;
      if (l.clientId) {
        const after = (salesByClient.get(l.clientId) ?? []).filter((o) => o.createdAt >= l.createdAt);
        if (after.length) {
          won++;
          wonSum += after.reduce((s, o) => s + o.totalAmount, 0);
        }
      }
      if (!isClosedStage(l.stage)) {
        open++;
        if (!l.nextTouchAt) noNext++;
        else if (day(l.nextTouchAt) < today) overdue++;
      }
    }
    const touched = ls.length - dist["0"];
    const byMgr = new Map<string, { leads: number; touched: number; calls7: number }>();
    for (const l of ls) {
      const k = l.managerEmail || "—";
      const row = byMgr.get(k) ?? { leads: 0, touched: 0, calls7: 0 };
      row.leads++;
      const ts = touchesBy.get(l.leadId) ?? [];
      if (ts.length) row.touched++;
      byMgr.set(k, row);
    }
    for (const t of touches) {
      if (!t.outcome || day(t.createdAt) < addDays(today, -6)) continue;
      const l = ls.find((x) => x.leadId === t.leadId);
      if (!l) continue;
      const row = byMgr.get(l.managerEmail || "—");
      if (row) row.calls7++;
    }
    const firstDay = ls.map((l) => day(l.createdAt)).sort()[0];
    P(`«${c}» (загружено ${firstDay}): ${ls.length} лидов; тронуто ${touched} (${pct(touched, ls.length)}); дозвонились ${reached}; стали покупателями ${won} на ${money(wonSum)}`);
    P(`  касаний на лида: ${BUCKETS.map((b) => `${b}: ${dist[b]}`).join(" · ")}`);
    P(`  в работе ${open}: просрочено ${overdue}, без следующего касания ${noNext}`);
    P(`  итог по последнему звонку: ${CALL_OUTCOMES.map((o) => `${o.label} ${lastOutcome[o.key] ?? 0}`).join(" · ")}`);
    for (const [k, r] of Array.from(byMgr.entries()).sort((a, b) => b[1].leads - a[1].leads))
      P(`  ${name.get(k.toLowerCase()) ?? k}: лидов ${r.leads}, тронуто ${r.touched} (${pct(r.touched, r.leads)}), звонков за 7 дней ${r.calls7}`);
    camp.push({ campaign: c, loaded: firstDay, leads: ls.length, touched, reached, won, wonSum, dist, open, overdue, noNext, lastOutcome, byManager: Object.fromEntries(Array.from(byMgr.entries()).map(([k, v]) => [name.get(k.toLowerCase()) ?? k, v])) });
  }
  out.campaigns = camp;

  // ---- 3. Лиды не из обзвона: реклама и прочие ----------------------------------------
  P("\n=== 3. Лиды не из базы обзвона ===");
  const groups: Record<string, typeof leads> = {
    "С рекламы (Земфира)": leads.filter((l) => l.origin === "ads"),
    "Остальные (вручную, WhatsApp)": leads.filter((l) => l.origin !== "ads" && !l.campaign),
  };
  const other: Record<string, unknown> = {};
  for (const [g, ls] of Object.entries(groups)) {
    const dist: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    let won = 0;
    let wonSum = 0;
    let lost = 0;
    let open = 0;
    let overdue = 0;
    let noNext = 0;
    for (const l of ls) {
      dist[bucket((touchesBy.get(l.leadId) ?? []).length)]++;
      if (l.clientId) {
        const after = (salesByClient.get(l.clientId) ?? []).filter((o) => o.createdAt >= l.createdAt);
        if (after.length) {
          won++;
          wonSum += after.reduce((s, o) => s + o.totalAmount, 0);
        }
      }
      if (l.stage === "lost") lost++;
      if (!isClosedStage(l.stage)) {
        open++;
        if (!l.nextTouchAt) noNext++;
        else if (day(l.nextTouchAt) < today) overdue++;
      }
    }
    const last30 = ls.filter((l) => day(l.createdAt) >= addDays(today, -29)).length;
    P(`${g}: ${ls.length} (за 30 дней ${last30}); стали покупателями ${won} на ${money(wonSum)}; отказ ${lost}; в работе ${open} (просрочено ${overdue}, без касания в плане ${noNext})`);
    P(`  касаний на лида: ${BUCKETS.map((b) => `${b}: ${dist[b]}`).join(" · ")}`);
    other[g] = { total: ls.length, last30, won, wonSum, lost, open, overdue, noNext, dist };
  }
  // Правило 2–5 касаний после передачи (реклама).
  const handed = groups["С рекламы (Земфира)"].filter((l) => l.handedOverAt);
  const after: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  let stale = 0;
  for (const l of handed) {
    const n = adsManagerTouches(l, touches).length;
    after[bucket(n)]++;
    if (n < 2 && !isClosedStage(l.stage) && !l.clientId && day(l.handedOverAt) <= addDays(today, -3)) stale++;
  }
  P(`  передано менеджерам ${handed.length}; касаний менеджера после передачи: ${BUCKETS.map((b) => `${b}: ${after[b]}`).join(" · ")}; переданы 3+ дня назад и меньше 2 касаний: ${stale}`);
  other.adsHanded = { handed: handed.length, after, stale };
  out.otherLeads = other;

  // ---- 4. Напоминаем ли о себе покупателям ------------------------------------------
  P("\n=== 4. Покупатели: напоминаем ли о себе ===");
  const lastOrder = new Map<string, string>();
  const revenue = new Map<string, number>();
  for (const o of sales) {
    if ((lastOrder.get(o.clientId) ?? "") < day(o.createdAt)) lastOrder.set(o.clientId, day(o.createdAt));
    revenue.set(o.clientId, (revenue.get(o.clientId) ?? 0) + o.totalAmount);
  }
  const outByKey = new Map<string, string>();
  for (const m of msgs) {
    if (m.direction !== "out") continue;
    const k = phoneKey(m.phone);
    if (k && (outByKey.get(k) ?? "") < m.at) outByKey.set(k, m.at);
  }
  const keysOf = (c: (typeof clients)[number]) => [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2].map(phoneKey).filter(Boolean);
  const buyers = clients.filter((c) => !c.retail && lastOrder.has(c.clientId));
  const rows = buyers.map((c) => {
    const lastMsg = keysOf(c).map((k) => outByKey.get(k) ?? "").sort().pop() ?? "";
    return { c, last: lastOrder.get(c.clientId)!, rev: revenue.get(c.clientId) ?? 0, lastMsg: day(lastMsg) };
  });
  const quiet = (d: number) => rows.filter((r) => r.last < addDays(today, -d));
  for (const d of [14, 30, 45]) {
    const q = quiet(d);
    const noMsg = q.filter((r) => !r.lastMsg || r.lastMsg < addDays(today, -14));
    P(`не заказывали ${d}+ дней: ${q.length} из ${rows.length} покупателей (выручка за всё время ${money(q.reduce((s, r) => s + r.rev, 0))}); из них нам не писали в WhatsApp 14 дней: ${noMsg.length}`);
  }
  const top = quiet(14).sort((a, b) => b.rev - a.rev).slice(0, 15);
  P("крупнейшие из молчащих 14+ дней:");
  for (const r of top) P(`  ${r.c.name} · ${r.c.city} · последняя заявка ${r.last} · всего ${money(r.rev)} · наше последнее сообщение ${r.lastMsg || "нет"} · менеджер ${name.get(r.c.managerEmail.toLowerCase()) ?? r.c.managerEmail}`);
  out.buyers = { total: rows.length, quiet14: quiet(14).length, quiet30: quiet(30).length, quiet45: quiet(45).length, quiet14noMsg: quiet(14).filter((r) => !r.lastMsg || r.lastMsg < addDays(today, -14)).length, top: top.map((r) => ({ name: r.c.name, city: r.c.city, last: r.last, rev: r.rev, lastMsg: r.lastMsg })) };

  // ---- 5. Рассылки -------------------------------------------------------------------
  P("\n=== 5. Рассылки ===");
  const delivery = deliveryByMessage(statuses);
  const inByKey = new Map<string, string[]>();
  for (const m of msgs) if (m.direction === "in" && !m.line) inByKey.set(phoneKey(m.phone), [...(inByKey.get(phoneKey(m.phone)) ?? []), m.at]);
  const ordersByKey = new Map<string, string[]>();
  for (const o of sales) {
    const c = clientById.get(o.clientId);
    const keys = new Set([phoneKey(o.clientPhone), ...(c ? keysOf(c) : [])].filter(Boolean));
    for (const k of Array.from(keys)) ordersByKey.set(k, [...(ordersByKey.get(k) ?? []), o.createdAt]);
  }
  const bc: unknown[] = [];
  let totSent = 0;
  let totRead = 0;
  let totReplied = 0;
  let totOrdered = 0;
  for (const b of broadcasts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
    const rs = recipients.filter((r) => r.broadcastId === b.broadcastId);
    const sent = rs.filter((r) => r.sentAt && r.messageId);
    if (!sent.length) continue;
    let read = 0;
    let replied = 0;
    let ordered = 0;
    for (const r of sent) {
      const st = delivery.get(r.messageId)?.status;
      if (st === "read") read++;
      const k = phoneKey(r.phone);
      const lim3 = new Date(new Date(r.sentAt).getTime() + 3 * 86400000).toISOString();
      const lim7 = new Date(new Date(r.sentAt).getTime() + 7 * 86400000).toISOString();
      if ((inByKey.get(k) ?? []).some((at) => at > r.sentAt && at <= lim3)) replied++;
      if ((ordersByKey.get(k) ?? []).some((at) => at > r.sentAt && at <= lim7)) ordered++;
    }
    totSent += sent.length;
    totRead += read;
    totReplied += replied;
    totOrdered += ordered;
    const pending = rs.filter((r) => !r.sentAt && r.status !== "skipped" && r.status !== "error").length;
    P(`${day(b.createdAt)} «${b.title}» [${b.status}]: отправлено ${sent.length}, прочитали ${read} (${pct(read, sent.length)}), ответили за 3 дня ${replied} (${pct(replied, sent.length)}), заказали за 7 дней ${ordered}; ждут отправки ${pending}`);
    bc.push({ date: day(b.createdAt), title: b.title, status: b.status, sent: sent.length, read, replied, ordered, pending });
  }
  P(`ИТОГО: отправлено ${totSent}, прочитали ${totRead} (${pct(totRead, totSent)}), ответили ${totReplied} (${pct(totReplied, totSent)}), заказали за 7 дней ${totOrdered} (${pct(totOrdered, totSent)})`);
  out.broadcasts = { list: bc, totSent, totRead, totReplied, totOrdered };

  // ---- 6. Бот ------------------------------------------------------------------------
  P("\n=== 6. Бот ===");
  const chats = botChats.filter((c) => c.context.length);
  const talked = chats.filter((c) => c.context.some((x) => x.role === "client"));
  const nudged = chats.filter((c) => c.nudge?.count > 0);
  const botOrders = sales.filter((o) => o.managerEmail === BOT_MANAGER_EMAIL);
  const botPaid = botOrders.filter((o) => o.paidAmount >= o.totalAmount - 1);
  const active30 = talked.filter((c) => day(c.updatedAt) >= addDays(today, -29));
  P(`чатов с памятью бота ${chats.length}; клиент писал ${talked.length}; живых за 30 дней ${active30.length}; дожимали ${nudged.length} (касаний ${nudged.reduce((s, c) => s + c.nudge.count, 0)})`);
  P(`заявок бота ${botOrders.length} на ${money(botOrders.reduce((s, o) => s + o.totalAmount, 0))}, оплачено полностью ${botPaid.length}; конверсия «написал → заказ» ${pct(new Set(botOrders.map((o) => o.clientId)).size, talked.length)}`);
  out.bot = { chats: chats.length, talked: talked.length, active30: active30.length, nudged: nudged.length, orders: botOrders.length, sum: botOrders.reduce((s, o) => s + o.totalAmount, 0), paid: botPaid.length };

  writeFileSync("../_private/sales-meeting.json", JSON.stringify(out, null, 2), "utf8");
  P("\nJSON: _private/sales-meeting.json");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
