import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Снимок для большого отчёта по продажам (10.11.2026, владелец: «аналитику по причинам отказов клиентов, по перепискам с
 * менеджерами, и вообще любую аналитику по продажам: по менеджерам, по цветку, по компаниям — в PDF»). Собирает готовые
 * расчёты CRM в один JSON: отчёт месяца по хозяйству и по каждой компании (`buildMonthReport`), клиенты (`buildClientAnalytics`),
 * деньги (`buildFinanceAnalytics`), переписки (`buildTalkReport`), причины отказов (стадия «Отказ» у лидов, разборы ИИ,
 * возражения, отказы словами в переписках — `looksLikeRefusal`). Ничего не меняет; телефоны в снимок не идут.
 *
 *   npx tsx scripts/diag-sales-report.ts <out.json> [месяц ГГГГ-ММ, по умолчанию прошлый]
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { loadMonthReport } from "../src/lib/repo/monthReport";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { listPayments } from "../src/lib/repo/payments";
import { listLeads, listLeadTouches } from "../src/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "../src/lib/repo/talks";
import { listWaLines } from "../src/lib/repo/waLines";
import { buildClientAnalytics } from "../src/lib/clientAnalytics";
import { buildFinanceAnalytics } from "../src/lib/financeAnalytics";
import { buildTalkReport, talkInfoByLead, objectionLabel, OBJECTION_KINDS } from "../src/lib/talkAnalysis";
import { looksLikeRefusal, } from "../src/lib/clientRefusal";
import { phoneKey, stageLabel } from "../src/lib/leads";
import { isBotOrder, isAssistantOrder } from "../src/lib/sellerChannel";
import { ORDER_STATUSES, FLOWER_TYPE_LABELS, getFarmFor, FARM_LABELS } from "../src/lib/constants";
import { isNotASale } from "../src/lib/orderKind";
import { localDayKey } from "../src/lib/timezone";
import { periodShift } from "../src/lib/constants";

const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || n;

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Укажите файл JSON");
  const today = localDayKey();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(process.argv[3] || "") ? process.argv[3] : periodShift(thisMonth, -1);
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS, SHEET_TABS.PAYMENTS, SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES]);
  const [orders, clients, users, payments, leads, touches, analyses, messages, lines] = await Promise.all([
    listOrdersWithItems(),
    listClients(),
    listUsers(),
    listPayments(),
    listLeads(),
    listLeadTouches(),
    listLeadAnalyses(),
    listWaMessages({ lines: "all" }),
    listWaLines(),
  ]);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
  const nameOf = (e: string) => firstName(nameByEmail.get((e || "").toLowerCase()) || e || "");
  const lineManager = new Map(lines.map((l) => [l.code, nameOf(l.managerEmail)]));
  lineManager.set("", "основной номер");
  lineManager.set("leads", "Земфира");

  // --- Месяц по хозяйству и по компаниям ---
  const months = [month, thisMonth];
  const monthReports: Record<string, Record<string, unknown>> = {};
  for (const m of months) {
    monthReports[m] = {};
    for (const farm of ["", "rose_farm", "esentai"]) monthReports[m][farm || "all"] = await loadMonthReport(m, farm);
  }

  // --- Клиенты и деньги ---
  const clientAnalytics = Object.fromEntries(months.map((m) => [m, buildClientAnalytics({ clients, orders, nameByEmail, period: m, today })]));
  const finance = Object.fromEntries(months.map((m) => [m, buildFinanceAnalytics({ orders, payments, nameByEmail, period: m, today })]));

  // --- Продажи: срезы, которых нет в готовых отчётах ---
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o));
  const inMonth = (o: (typeof orders)[number], m: string) => localDayKey(new Date(o.createdAt)).startsWith(m);
  const amountOf = (o: (typeof orders)[number]) => o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const sales: Record<string, unknown> = {};
  for (const m of months) {
    const mine = live.filter((o) => inMonth(o, m));
    const agg = (key: (o: (typeof orders)[number]) => string) => {
      const map = new Map<string, { amount: number; orders: number; stems: number; clients: Set<string> }>();
      for (const o of mine) {
        const k = key(o);
        const e = map.get(k) ?? { amount: 0, orders: 0, stems: 0, clients: new Set() };
        e.amount += amountOf(o);
        e.orders += 1;
        e.stems += o.items.reduce((s, i) => s + i.quantity, 0);
        e.clients.add(o.clientId || phoneKey(o.clientPhone) || o.clientName);
        map.set(k, e);
      }
      return Array.from(map)
        .map(([name, e]) => ({ name, amount: Math.round(e.amount), orders: e.orders, stems: e.stems, clients: e.clients.size }))
        .sort((a, b) => b.amount - a.amount);
    };
    const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const channel = (o: (typeof orders)[number]) => (isBotOrder(o) ? "Бот основного номера" : isAssistantOrder(o) ? "ИИ-помощник менеджера" : "Менеджер");
    const gradeRows = new Map<string, { amount: number; stems: number }>();
    for (const o of mine)
      for (const i of o.items) {
        const k = `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType}|${i.grade}`;
        const e = gradeRows.get(k) ?? { amount: 0, stems: 0 };
        e.amount += i.quantity * i.unitPrice;
        e.stems += i.quantity;
        gradeRows.set(k, e);
      }
    const farmRows = new Map<string, { amount: number; stems: number }>();
    for (const o of mine)
      for (const i of o.items) {
        const k = FARM_LABELS[getFarmFor(i.flowerType) || ""] ?? "?";
        const e = farmRows.get(k) ?? { amount: 0, stems: 0 };
        e.amount += i.quantity * i.unitPrice;
        e.stems += i.quantity;
        farmRows.set(k, e);
      }
    sales[m] = {
      total: { amount: Math.round(mine.reduce((s, o) => s + amountOf(o), 0)), orders: mine.length, stems: mine.reduce((s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0), 0), clients: new Set(mine.map((o) => o.clientId || o.clientName)).size },
      byManager: agg((o) => nameOf(o.managerEmail) || "без менеджера"),
      byDirection: agg((o) => o.direction || (o.retail ? `Розница ${o.retail}` : "Алматы / опт")),
      byPaymentMethod: agg((o) => o.paymentMethod || "не указан"),
      byWeekday: agg((o) => WD[new Date(o.createdAt).getUTCDay()]),
      byChannel: agg(channel),
      byStore: agg((o) => (o.store === "office" ? "Офис" : "Основной склад")),
      byFarm: Array.from(farmRows).map(([name, e]) => ({ name, amount: Math.round(e.amount), stems: e.stems })).sort((a, b) => b.amount - a.amount),
      byGrade: Array.from(gradeRows).map(([k, e]) => ({ flower: k.split("|")[0], grade: k.split("|")[1], amount: Math.round(e.amount), stems: e.stems })).sort((a, b) => b.amount - a.amount),
    };
  }

  // --- Переписки с менеджерами ---
  const now = new Date();
  const infos = Array.from(talkInfoByLead(leads, messages, analyses).values());
  const talk60 = buildTalkReport(infos, nameByEmail, now, 60);
  const talk30 = buildTalkReport(infos, nameByEmail, now, 30);
  const since60 = new Date(now.getTime() - 60 * 86400000).toISOString();
  // Скорость ответа по номерам: от сообщения клиента до нашего ответа (медиана, минуты), доля ответов ИИ по журналу нет —
  // считаем просто «кто ответил первым после клиента».
  const byLine = new Map<string, { chats: Set<string>; incoming: number; outgoing: number; replyMins: number[]; unanswered: number }>();
  const byPhoneLine = new Map<string, typeof messages>();
  for (const m of messages) {
    if (m.at < since60) continue;
    const k = `${m.line || ""}|${phoneKey(m.phone)}`;
    const list = byPhoneLine.get(k) ?? [];
    list.push(m);
    byPhoneLine.set(k, list);
  }
  for (const [k, list] of byPhoneLine) {
    const line = k.split("|")[0];
    const e = byLine.get(line) ?? { chats: new Set(), incoming: 0, outgoing: 0, replyMins: [], unanswered: 0 };
    e.chats.add(k);
    const sorted = list.sort((a, b) => (a.at < b.at ? -1 : 1));
    let pendingIn: string | null = null;
    for (const m of sorted) {
      if (m.direction === "in") {
        e.incoming += 1;
        if (!pendingIn) pendingIn = m.at;
      } else {
        e.outgoing += 1;
        if (pendingIn) {
          e.replyMins.push((Date.parse(m.at) - Date.parse(pendingIn)) / 60000);
          pendingIn = null;
        }
      }
    }
    if (pendingIn) e.unanswered += 1;
    byLine.set(line, e);
  }
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)]);
  };
  const chatsByLine = Array.from(byLine).map(([line, e]) => ({
    line,
    manager: lineManager.get(line) || line,
    chats: e.chats.size,
    incoming: e.incoming,
    outgoing: e.outgoing,
    medianReplyMin: med(e.replyMins),
    repliedWithinHour: e.replyMins.length ? Math.round((100 * e.replyMins.filter((x) => x <= 60).length) / e.replyMins.length) : null,
    unanswered: e.unanswered,
  }));

  // --- Причины отказов ---
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x || "не указана", (m.get(x || "не указана") ?? 0) + 1);
    return Array.from(m)
      .map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count);
  };
  const lost = leads.filter((l) => l.stage === "lost");
  const lost60 = lost.filter((l) => (l.stageChangedAt || l.createdAt) >= since60);
  const lostByManager = new Map<string, string[]>();
  for (const l of lost60) lostByManager.set(nameOf(l.managerEmail) || "ничей", [...(lostByManager.get(nameOf(l.managerEmail) || "ничей") ?? []), l.lostReason]);
  const fresh = analyses.filter((a) => a.createdAt >= since60);
  const latest = new Map<string, (typeof analyses)[number]>();
  for (const a of fresh) if (!latest.has(a.leadId) || latest.get(a.leadId)!.createdAt < a.createdAt) latest.set(a.leadId, a);
  const latestList = Array.from(latest.values());
  const objByManager = new Map<string, string[]>();
  for (const a of latestList) for (const o of a.objections) objByManager.set(nameOf(a.managerEmail) || "ничей", [...(objByManager.get(nameOf(a.managerEmail) || "ничей") ?? []), objectionLabel(o.kind)]);
  const quotes = latestList.flatMap((a) => a.objections.map((o) => ({ kind: objectionLabel(o.kind), quote: o.quote.slice(0, 140), manager: nameOf(a.managerEmail) }))).filter((q) => q.quote.length > 8);
  const refusalsChat = messages
    .filter((m) => m.direction === "in" && m.at >= since60 && looksLikeRefusal(m.text))
    .map((m) => ({ line: lineManager.get(m.line || "") || m.line, text: m.text.replace(/\s+/g, " ").slice(0, 120), at: m.at.slice(0, 10) }));
  const callOutcomes = count(touches.filter((t) => t.createdAt >= since60 && t.outcome).map((t) => t.outcome));
  const refusals = {
    leadsLostAll: lost.length,
    leadsLost60: lost60.length,
    reasonsAll: count(lost.map((l) => l.lostReason)),
    reasons60: count(lost60.map((l) => l.lostReason)),
    reasonsByManager60: Array.from(lostByManager).map(([manager, rs]) => ({ manager, total: rs.length, reasons: count(rs) })),
    lostBySource60: count(lost60.map((l) => l.source || "не указан")),
    analysed60: latestList.length,
    aiLostReasons: count(latestList.filter((a) => a.decision === "lost" || a.lostReason).map((a) => a.lostReason || "отказ без причины")),
    aiDecisions: count(latestList.map((a) => a.decision || "старый разбор")),
    objections: talk60.objections,
    objectionsByManager: Array.from(objByManager).map(([manager, os]) => ({ manager, total: os.length, kinds: count(os) })),
    objectionQuotes: quotes.slice(0, 40),
    chatRefusals: { total: refusalsChat.length, byLine: count(refusalsChat.map((r) => r.line || "?")), samples: refusalsChat.slice(-30) },
    callOutcomes,
    objectionKinds: OBJECTION_KINDS.map((o) => o.label),
    stages: count(leads.filter((l) => l.stage !== "lost").map((l) => stageLabel(l.stage) || "Новый")),
  };

  const snapshot = {
    generatedAt: now.toISOString(),
    today,
    month,
    thisMonth,
    managers: users.filter((u) => u.active && u.role === "manager").map((u) => firstName(u.name)),
    monthReports,
    clientAnalytics,
    finance,
    sales,
    talk: { days60: talk60, days30: talk30, chatsByLine },
    refusals,
  };
  writeFileSync(out, JSON.stringify(snapshot, null, 1), "utf8");
  const s = snapshot.sales[month] as { total: { amount: number; orders: number } };
  console.log(`JSON: ${out} · ${month}: продаж ${s.total.amount.toLocaleString("ru-RU")} ₸ в ${s.total.orders} заявках · отказов лидов за 60 дн. ${refusals.leadsLost60} · разборов переписок ${refusals.analysed60} · отказов словами в чатах ${refusalsChat.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
