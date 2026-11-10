import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Глубокая аналитика переписок по каждому менеджеру (10.11.2026, владелец: «очень мало аналитики именно по перепискам с
 * клиентами каждого менеджера: причины отказа, долгие ответы и всё, что связано с переписками»). По журналу WhatsApp
 * всех номеров за N дней: кто написал первым, скорость ответа (медиана, 75 %, 90 %, по часам дня, по дням недели,
 * корзины ожидания), долгие ответы и чаты без ответа с примерами, сколько ответил сам менеджер / ИИ / рассылка,
 * чаты → заявки за 7 дней (конверсия), отказы словами по видам с примерами, возражения и причины отказов из разборов
 * ИИ, лиды и касания. Телефоны — только последние 4 цифры. JSON для отчёта. Ничего не меняет.
 *
 *   npx tsx scripts/diag-chats-report.ts <out.json> [дней, 60]
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { listLeads, listLeadTouches } from "../src/lib/repo/leads";
import { listLeadAnalyses, listWaMessages } from "../src/lib/repo/talks";
import { listWaLines, listAssistantLog } from "../src/lib/repo/waLines";
import { listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { looksLikeRefusal } from "../src/lib/clientRefusal";
import { objectionLabel } from "../src/lib/talkAnalysis";
import { phoneKey, stageLabel } from "../src/lib/leads";
import { ORDER_STATUSES } from "../src/lib/constants";
import { isNotASale } from "../src/lib/orderKind";
import { mergeMessages } from "../src/lib/whatsapp";
import { isAckOnly } from "../src/lib/broadcast";
import type { WaMessage } from "../src/lib/types";

const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || n;
const ALMATY_MS = 5 * 3600000;
const hourOf = (iso: string) => new Date(Date.parse(iso) + ALMATY_MS).getUTCHours();
const wdOf = (iso: string) => new Date(Date.parse(iso) + ALMATY_MS).getUTCDay();
const dayOf = (iso: string) => new Date(Date.parse(iso) + ALMATY_MS).toISOString().slice(0, 10);
const q = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
};
const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Array.from(m)
    .map(([name, n]) => ({ name, count: n }))
    .sort((a, b) => b.count - a.count);
};
/** Кивок, смайлик, чек или файл без слов — ответа не ждёт, в скорость ответа не считается. */
const needsReply = (m: WaMessage) => {
  const t = (m.text || "").trim();
  if (!t) return m.type === "text" || m.type === "voice";
  if (isAckOnly(t)) return false;
  if (/^[\p{Emoji}\p{Emoji_Presentation}\s\u200d\ufe0f]+$/u.test(t)) return false;
  if (/^receipt_|^\[image\]|^\[document\]/i.test(t)) return false;
  return true;
};
const BUCKETS: [string, number][] = [["до 5 мин", 5], ["5–30 мин", 30], ["30–60 мин", 60], ["1–3 ч", 180], ["3–12 ч", 720], ["12–24 ч", 1440], ["дольше суток", Infinity]];
const bucketOf = (min: number) => BUCKETS.find(([, lim]) => min <= lim)![0];

/** Вид отказа по словам клиента — грубо, по ключевым словам. */
function refusalKind(text: string): string {
  const t = text.toLowerCase();
  if (/для себя|себе|не для продажи|букет|подар|один|одну|штучк|пару штук|розниц/.test(t)) return "Розница, для себя";
  if (/рассад|семен|саженц|корн|горш|тамыр|посад|огород|луков/.test(t)) return "Рассада, семена, с корнями";
  if (/дорог|цена|по цене|дешевл|скидк|қымбат/.test(t)) return "Дорого";
  if (/поставщик|берем у|беру у|есть у кого|свой постав|работаем с/.test(t)) return "Есть поставщик";
  if (/позже|потом|пока нет|не сейчас|через|на след|после/.test(t)) return "Не сейчас, позже";
  if (/нет в наличии|нет нужн|не тот|другой сорт|не подход|цвет|длин|мелк|коротк/.test(t)) return "Не подошёл товар";
  if (/не нужн|не надо|не интерес|керек емес|не актуальн|нет спасибо|нет, спасибо|не буду|отказ|жоқ|жок/.test(t)) return "Не нужно, не интересует";
  if (/стоп|не пиш|удал|заблок|спам/.test(t)) return "Просит не писать";
  return "Другое";
}

async function main() {
  const out = process.argv[2];
  const days = Number(process.argv[3]) || 60;
  if (!out) throw new Error("Укажите файл JSON");
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.USERS, SHEET_TABS.SETTINGS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.LEAD_ANALYSES]);
  const [messagesAll, lines, log, recipients, users, map, orders, clients, leads, touches, analyses] = await Promise.all([
    listWaMessages({ lines: "all" }),
    listWaLines(),
    listAssistantLog(),
    listRecipients(),
    listUsers(),
    settingsMap(),
    listOrdersWithItems(),
    listClients(),
    listLeads(),
    listLeadTouches(),
    listLeadAnalyses(),
  ]);
  const staff = await ourPhoneKeys(map);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), firstName(u.name)]));
  const nameOf = (e: string) => nameByEmail.get((e || "").toLowerCase()) || e || "";
  const lineOwner = new Map<string, string>([["", "Основной номер (бот)"], ["leads", "Земфира"]]);
  for (const l of lines) lineOwner.set(l.code, nameOf(l.managerEmail) || l.code);
  const autoKind = new Map(log.filter((r) => r.kind !== "note").map((r) => [r.messageId, r.kind]));
  const notesByLine = count(log.filter((r) => r.kind === "note" && r.at >= since).map((r) => r.line || ""));
  const bcIds = new Set(recipients.map((r) => r.messageId).filter(Boolean));
  const clientByKey = new Map<string, (typeof clients)[number]>();
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p) && !clientByKey.has(phoneKey(p))) clientByKey.set(phoneKey(p), c);
  const leadByKey = new Map<string, (typeof leads)[number]>();
  for (const l of leads) if (phoneKey(l.phone) && !leadByKey.has(phoneKey(l.phone))) leadByKey.set(phoneKey(l.phone), l);
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o));
  const ordersByKey = new Map<string, { at: string; amount: number; id: string }[]>();
  for (const o of live) {
    const keys = new Set([phoneKey(o.clientPhone), ...(clients.filter((c) => c.clientId === o.clientId).flatMap((c) => [phoneKey(c.phone), phoneKey(c.messenger)]))].filter(Boolean));
    for (const k of keys) ordersByKey.set(k, [...(ordersByKey.get(k) ?? []), { at: o.createdAt, amount: o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), id: o.orderId }]);
  }
  const whoIs = (key: string) => {
    const c = clientByKey.get(key);
    if (c) return { name: c.name, kind: "клиент", manager: nameOf(c.managerEmail) };
    const l = leadByKey.get(key);
    if (l) return { name: l.name, kind: "лид", manager: nameOf(l.managerEmail) };
    return { name: "", kind: "контакт", manager: "" };
  };

  const messages = mergeMessages(messagesAll.filter((m) => m.at >= since && !staff.has(phoneKey(m.phone)) && phoneKey(m.phone)));
  const byChat = new Map<string, WaMessage[]>();
  for (const m of messages) {
    const k = `${m.line || ""}|${phoneKey(m.phone)}`;
    byChat.set(k, [...(byChat.get(k) ?? []), m]);
  }

  type Reply = { line: string; key: string; waitMin: number; askedAt: string; askedText: string; by: "менеджер" | "ИИ" | "рассылка" };
  const replies: Reply[] = [];
  const unanswered: { line: string; key: string; name: string; kind: string; sinceAt: string; waitHours: number; text: string }[] = [];
  const chatRows: { line: string; key: string; name: string; kind: string; firstBy: "клиент" | "мы"; incoming: number; outgoing: number; own: number; ai: number; bc: number; lastAt: string; lastBy: string; refusal: boolean; ordered: boolean; orderAmount: number; firstReplyMin: number | null }[] = [];
  const refusals: { line: string; key: string; name: string; kind: string; at: string; text: string; refusalKind: string }[] = [];

  for (const [k, list] of byChat) {
    const [line, key] = k.split("|");
    const sorted = list.sort((a, b) => (a.at < b.at ? -1 : 1));
    const who = whoIs(key);
    let pending: WaMessage | null = null;
    let own = 0, ai = 0, bc = 0, inc = 0, outg = 0;
    let firstReply: number | null = null;
    for (const m of sorted) {
      if (m.direction === "in") {
        inc++;
        if (!pending && needsReply(m)) pending = m;
        if (looksLikeRefusal(m.text)) refusals.push({ line, key, name: who.name, kind: who.kind, at: m.at, text: m.text.replace(/\s+/g, " ").slice(0, 140), refusalKind: refusalKind(m.text) });
      } else {
        outg++;
        const by = bcIds.has(m.messageId) ? "рассылка" : autoKind.has(m.messageId) || m.source === "assistant" ? "ИИ" : "менеджер";
        if (by === "менеджер") own++;
        else if (by === "ИИ") ai++;
        else bc++;
        if (pending && by !== "рассылка") {
          const waitMin = (Date.parse(m.at) - Date.parse(pending.at)) / 60000;
          replies.push({ line, key, waitMin, askedAt: pending.at, askedText: (pending.text || `[${pending.type}]`).replace(/\s+/g, " ").slice(0, 110), by });
          if (firstReply === null) firstReply = waitMin;
          pending = null;
        }
      }
    }
    const last = sorted[sorted.length - 1];
    if (pending && now.getTime() - Date.parse(pending.at) > 3600000) {
      unanswered.push({ line, key, name: who.name, kind: who.kind, sinceAt: pending.at, waitHours: Math.round((now.getTime() - Date.parse(pending.at)) / 3600000), text: (pending.text || `[${pending.type}]`).replace(/\s+/g, " ").slice(0, 110) });
    }
    const firstIn = sorted.find((m) => m.direction === "in");
    const ordersAfter = (ordersByKey.get(key) ?? []).filter((o) => firstIn && o.at >= firstIn.at && Date.parse(o.at) - Date.parse(firstIn.at) <= 7 * 86400000);
    chatRows.push({
      line, key, name: who.name, kind: who.kind, firstBy: sorted[0].direction === "in" ? "клиент" : "мы", incoming: inc, outgoing: outg, own, ai, bc,
      lastAt: last.at, lastBy: last.direction === "in" ? "клиент" : "мы", refusal: sorted.some((m) => m.direction === "in" && looksLikeRefusal(m.text)),
      ordered: ordersAfter.length > 0, orderAmount: ordersAfter.reduce((s, o) => s + o.amount, 0), firstReplyMin: firstReply,
    });
  }

  // --- По линиям / менеджерам ---
  const linesOut = Array.from(new Set([...chatRows.map((c) => c.line)])).map((line) => {
    const chats = chatRows.filter((c) => c.line === line);
    const rs = replies.filter((r) => r.line === line);
    const own = rs.filter((r) => r.by === "менеджер");
    const waits = rs.map((r) => r.waitMin);
    const withIn = chats.filter((c) => c.incoming > 0);
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, asked: 0, waits: [] as number[] }));
    for (const r of rs) {
      const h = hourOf(r.askedAt);
      byHour[h].asked++;
      byHour[h].waits.push(r.waitMin);
    }
    const inByHour = Array.from({ length: 24 }, () => 0);
    const inByWd = Array.from({ length: 7 }, () => 0);
    for (const [k, list] of byChat) if (k.startsWith(`${line}|`)) for (const m of list) if (m.direction === "in") { inByHour[hourOf(m.at)]++; inByWd[wdOf(m.at)]++; }
    const byWeek = new Map<string, { in: number; out: number; waits: number[] }>();
    for (const [k, list] of byChat) if (k.startsWith(`${line}|`)) for (const m of list) {
      const d = dayOf(m.at); const wk = new Date(Date.parse(d) - ((new Date(d).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      const e = byWeek.get(wk) ?? { in: 0, out: 0, waits: [] };
      if (m.direction === "in") e.in++; else e.out++;
      byWeek.set(wk, e);
    }
    for (const r of rs) { const d = dayOf(r.askedAt); const wk = new Date(Date.parse(d) - ((new Date(d).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); byWeek.get(wk)?.waits.push(r.waitMin); }
    const slow = rs.filter((r) => r.waitMin > 60).sort((a, b) => b.waitMin - a.waitMin);
    const refs = refusals.filter((r) => r.line === line);
    const unans = unanswered.filter((u) => u.line === line).sort((a, b) => b.waitHours - a.waitHours);
    const converted = withIn.filter((c) => c.ordered);
    return {
      line,
      manager: lineOwner.get(line) || line,
      chats: chats.length,
      chatsWithIncoming: withIn.length,
      clientFirst: chats.filter((c) => c.firstBy === "клиент").length,
      weFirst: chats.filter((c) => c.firstBy === "мы").length,
      incoming: chats.reduce((s, c) => s + c.incoming, 0),
      outgoing: chats.reduce((s, c) => s + c.outgoing, 0),
      ownMessages: chats.reduce((s, c) => s + c.own, 0),
      aiMessages: chats.reduce((s, c) => s + c.ai, 0),
      broadcastMessages: chats.reduce((s, c) => s + c.bc, 0),
      aiNotes: notesByLine.find((n) => n.name === line)?.count ?? 0,
      replies: rs.length,
      repliesByManager: own.length,
      repliesByAi: rs.filter((r) => r.by === "ИИ").length,
      wait: { median: q(waits, 0.5), p75: q(waits, 0.75), p90: q(waits, 0.9), within5: rs.filter((r) => r.waitMin <= 5).length, within60: rs.filter((r) => r.waitMin <= 60).length, over60: slow.length, over720: rs.filter((r) => r.waitMin > 720).length },
      waitManager: { median: q(own.map((r) => r.waitMin), 0.5), p90: q(own.map((r) => r.waitMin), 0.9) },
      firstReply: { median: q(chats.map((c) => c.firstReplyMin).filter((x): x is number => x !== null), 0.5), p90: q(chats.map((c) => c.firstReplyMin).filter((x): x is number => x !== null), 0.9) },
      buckets: BUCKETS.map(([b]) => ({ name: b, count: rs.filter((r) => bucketOf(r.waitMin) === b).length })),
      byHour: byHour.map((h) => ({ hour: h.hour, asked: h.asked, median: q(h.waits, 0.5), over60: h.waits.filter((w) => w > 60).length })),
      incomingByHour: inByHour,
      incomingByWeekday: inByWd,
      byWeek: Array.from(byWeek).sort().map(([wk, e]) => ({ week: wk, in: e.in, out: e.out, median: q(e.waits, 0.5), over60: e.waits.filter((w) => w > 60).length })),
      slowExamples: slow.slice(0, 8).map((r) => ({ ...whoIs(r.key), tail: r.key.slice(-4), waitMin: Math.round(r.waitMin), at: r.askedAt, text: r.askedText })),
      unanswered: unans.length,
      unansweredClients: unans.filter((u) => u.kind === "клиент").length,
      unansweredExamples: unans.slice(0, 8).map((u) => ({ name: u.name, kind: u.kind, tail: u.key.slice(-4), waitHours: u.waitHours, text: u.text })),
      conversion: { chatsWithIncoming: withIn.length, ordered: converted.length, amount: Math.round(converted.reduce((s, c) => s + c.orderAmount, 0)), clientsNotOrdered: withIn.filter((c) => !c.ordered && c.kind === "клиент").length, leadsNotOrdered: withIn.filter((c) => !c.ordered && c.kind === "лид").length, contactsNotOrdered: withIn.filter((c) => !c.ordered && c.kind === "контакт").length },
      refusals: { total: refs.length, chats: new Set(refs.map((r) => r.key)).size, byKind: count(refs.map((r) => r.refusalKind)), byWho: count(refs.map((r) => r.kind)), examples: refs.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10).map((r) => ({ name: r.name, kind: r.kind, tail: r.key.slice(-4), at: r.at.slice(0, 10), kindOf: r.refusalKind, text: r.text })) },
      lastByClient: chats.filter((c) => c.lastBy === "клиент").length,
      topChats: chats.sort((a, b) => b.incoming + b.outgoing - a.incoming - a.outgoing).slice(0, 6).map((c) => ({ name: c.name || `…${c.key.slice(-4)}`, kind: c.kind, msgs: c.incoming + c.outgoing, ordered: c.ordered })),
    };
  });

  // --- Разборы ИИ по менеджерам ---
  const fresh = analyses.filter((a) => a.createdAt >= since);
  const latest = new Map<string, (typeof analyses)[number]>();
  for (const a of fresh) if (!latest.has(a.leadId) || latest.get(a.leadId)!.createdAt < a.createdAt) latest.set(a.leadId, a);
  const byMgr = new Map<string, (typeof analyses)[number][]>();
  for (const a of latest.values()) byMgr.set(nameOf(a.managerEmail) || "ничей", [...(byMgr.get(nameOf(a.managerEmail) || "ничей") ?? []), a]);
  const analysisByManager = Array.from(byMgr).map(([manager, list]) => {
    const scores = list.map((a) => a.score).filter((s): s is number => s !== null);
    const items: Record<string, { yes: number; total: number }> = {};
    for (const a of list) for (const c of a.checklist) {
      if (c.mark === "na") continue;
      const e = items[c.key] ?? { yes: 0, total: 0 };
      e.total++;
      if (c.mark === "yes") e.yes++;
      items[c.key] = e;
    }
    return {
      manager,
      analysed: list.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      items: Object.fromEntries(Object.entries(items).map(([k, e]) => [k, e.total ? Math.round((100 * e.yes) / e.total) : null])),
      temperature: count(list.map((a) => a.temperature || "не оценена")),
      decisions: count(list.map((a) => a.decision || "старый разбор")),
      lostReasons: count(list.filter((a) => a.decision === "lost" || a.lostReason).map((a) => a.lostReason || "без причины")),
      objections: count(list.flatMap((a) => a.objections.map((o) => objectionLabel(o.kind)))),
      objectionQuotes: list.flatMap((a) => a.objections.map((o) => ({ kind: objectionLabel(o.kind), quote: o.quote.replace(/\s+/g, " ").slice(0, 120) }))).filter((x) => x.quote.length > 8).slice(0, 8),
      advice: list.map((a) => a.advice).filter(Boolean).slice(0, 5).map((x) => x.slice(0, 160)),
      replyMinutes: q(list.map((a) => a.replyMinutes).filter((x): x is number => x !== null), 0.5),
    };
  });

  // --- Лиды и касания по менеджерам ---
  const leadsByMgr = Array.from(new Set(leads.map((l) => nameOf(l.managerEmail) || "ничей"))).map((manager) => {
    const mine = leads.filter((l) => (nameOf(l.managerEmail) || "ничей") === manager);
    const fresh = mine.filter((l) => l.createdAt >= since);
    const myTouches = touches.filter((t) => t.createdAt >= since && (nameOf(t.managerEmail) || "ничей") === manager);
    return {
      manager,
      leads: mine.length,
      newLeads: fresh.length,
      touches: myTouches.length,
      touchedLeads: new Set(myTouches.map((t) => t.leadId)).size,
      stages: count(mine.map((l) => stageLabel(l.stage) || "Новый")),
      becameClients: mine.filter((l) => l.clientId).length,
      lost: mine.filter((l) => l.stage === "lost").length,
      lostReasons: count(mine.filter((l) => l.stage === "lost").map((l) => l.lostReason || "не указана")),
      overdueTouches: mine.filter((l) => l.stage !== "lost" && l.nextTouchAt && l.nextTouchAt < now.toISOString().slice(0, 10)).length,
    };
  }).filter((m) => m.leads > 0).sort((a, b) => b.leads - a.leads);

  const snapshot = { generatedAt: now.toISOString(), days, since, lines: linesOut.sort((a, b) => b.incoming - a.incoming), analysisByManager, leadsByMgr, refusalKinds: count(refusals.map((r) => r.refusalKind)), totals: { chats: chatRows.length, incoming: chatRows.reduce((s, c) => s + c.incoming, 0), replies: replies.length, unanswered: unanswered.length, refusals: refusals.length } };
  writeFileSync(out, JSON.stringify(snapshot, null, 1), "utf8");
  console.log(`JSON: ${out} · чатов ${chatRows.length}, входящих ${snapshot.totals.incoming}, ответов ${replies.length}, без ответа ${unanswered.length}, отказов словами ${refusals.length}`);
  for (const l of snapshot.lines) console.log(`  ${l.manager.padEnd(22)} чатов ${String(l.chats).padStart(4)} · вх ${String(l.incoming).padStart(5)} · медиана ${l.wait.median} мин · 90 % ${l.wait.p90} мин · >1 ч ${l.wait.over60} · без ответа ${l.unanswered} · ИИ ${l.aiMessages} из ${l.outgoing} · заказали ${l.conversion.ordered}/${l.conversion.chatsWithIncoming} · отказов ${l.refusals.total}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
