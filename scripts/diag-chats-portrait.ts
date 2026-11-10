import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Портрет общения каждого менеджера по переписке (10.11.2026, владелец: «дай понимание портрета по каждому менеджеру
 * в плане общения, очень точную и здравую аналитику»). Дополняет `diag-chats-report.ts`: манера (длина, вопросы, цены,
 * голосовые, фото, смайлики, приветствия, казахский, массовые одинаковые сообщения с телефона), когда пишет (часы,
 * выходные, ночь), динамика диалога (сообщений на чат, кто заканчивает разговор, наш вопрос без ответа клиента), жалобы
 * клиентов на молчание, вежливость и извинения, первый ответ новому контакту, время от первого сообщения до заявки,
 * ответы ИИ по часам, и 2–3 характерных отрывка переписки на номер. Телефоны — последние 4 цифры. Ничего не меняет.
 *
 *   npx tsx scripts/diag-chats-portrait.ts <out.json> [дней, 60]
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { listLeads } from "../src/lib/repo/leads";
import { listWaMessages } from "../src/lib/repo/talks";
import { listWaLines, listAssistantLog } from "../src/lib/repo/waLines";
import { listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { looksLikeRefusal } from "../src/lib/clientRefusal";
import { phoneKey } from "../src/lib/leads";
import { ORDER_STATUSES } from "../src/lib/constants";
import { isNotASale } from "../src/lib/orderKind";
import { mergeMessages } from "../src/lib/whatsapp";
import { isAckOnly } from "../src/lib/broadcast";
import { parseStyleProfile, STYLE_SETTING_PREFIX } from "../src/lib/managerStyle";
import type { WaMessage } from "../src/lib/types";

const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || n;
const ALMATY_MS = 5 * 3600000;
const hourOf = (iso: string) => new Date(Date.parse(iso) + ALMATY_MS).getUTCHours();
const wdOf = (iso: string) => new Date(Date.parse(iso) + ALMATY_MS).getUTCDay();
const q = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
};
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Array.from(m).map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
};
const EMOJI = /\p{Extended_Pictographic}/u;
const KZ = /[әғқңөұүһі]|салем|сәлем|жаксы|жақсы|рахмет|керек|болды|бар ма|жок|жоқ|калай|қалай|иә\b/i;
const GREET = /^(здравствуйте|добр|салем|сәлем|сәлеметсіз|салеметсызбе|ассалаума|уалейкум|привет|здравствуй)/i;
const PRICE = /\d\s?(тг|тенге|₸)|\b\d{3,6}\s?(тг|₸)|по \d{3}/i;
const COMPLAINT = /не отвеча|почему молч|ау\b|вы здесь|вы тут|жду ответ|долго|где ответ|ответьте|так и не|почему не|сколько ждать|тишина/i;
const POLITE = /пожалуйста|пож-та|спасибо|рахмет|благодар|рады|удачи|хорошего дня/i;
const SORRY = /извин|прошу прощен|простите|кешір|сорри|виноват/i;
const QUESTION = /\?\s*$/;
const needsReply = (m: WaMessage) => {
  const t = (m.text || "").trim();
  if (!t) return m.type === "text" || m.type === "voice";
  if (isAckOnly(t)) return false;
  if (/^[\p{Emoji}\p{Emoji_Presentation}\s‍️]+$/u.test(t)) return false;
  if (/^receipt_|^\[image\]|^\[document\]/i.test(t)) return false;
  return true;
};

async function main() {
  const out = process.argv[2];
  const days = Number(process.argv[3]) || 60;
  if (!out) throw new Error("Укажите файл JSON");
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.USERS, SHEET_TABS.SETTINGS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.LEADS]);
  const [messagesAll, lines, log, recipients, users, map, orders, clients, leads] = await Promise.all([
    listWaMessages({ lines: "all" }), listWaLines(), listAssistantLog(), listRecipients(), listUsers(), settingsMap(), listOrdersWithItems(), listClients(), listLeads(),
  ]);
  const staff = await ourPhoneKeys(map);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), firstName(u.name)]));
  const nameOf = (e: string) => nameByEmail.get((e || "").toLowerCase()) || e || "";
  const lineOwner = new Map<string, string>([["", "Основной номер (бот)"], ["leads", "Земфира"]]);
  for (const l of lines) lineOwner.set(l.code, nameOf(l.managerEmail) || l.code);
  const autoIds = new Set(log.filter((r) => r.kind !== "note").map((r) => r.messageId));
  const bcIds = new Set(recipients.map((r) => r.messageId).filter(Boolean));
  const clientByKey = new Map<string, (typeof clients)[number]>();
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p) && !clientByKey.has(phoneKey(p))) clientByKey.set(phoneKey(p), c);
  const leadByKey = new Map<string, (typeof leads)[number]>();
  for (const l of leads) if (phoneKey(l.phone) && !leadByKey.has(phoneKey(l.phone))) leadByKey.set(phoneKey(l.phone), l);
  const whoIs = (key: string) => clientByKey.get(key) ? { name: clientByKey.get(key)!.name, kind: "клиент" } : leadByKey.get(key) ? { name: leadByKey.get(key)!.name, kind: "лид" } : { name: "", kind: "контакт" };
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o));
  const ordersByKey = new Map<string, { at: string; amount: number }[]>();
  for (const o of live) {
    const keys = new Set([phoneKey(o.clientPhone), ...clients.filter((c) => c.clientId === o.clientId).flatMap((c) => [phoneKey(c.phone), phoneKey(c.messenger)])].filter(Boolean));
    for (const k of keys) ordersByKey.set(k, [...(ordersByKey.get(k) ?? []), { at: o.createdAt, amount: o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) }]);
  }
  const messages = mergeMessages(messagesAll.filter((m) => m.at >= since && !staff.has(phoneKey(m.phone)) && phoneKey(m.phone)));
  const byChat = new Map<string, WaMessage[]>();
  for (const m of messages) {
    const k = `${m.line || ""}|${phoneKey(m.phone)}`;
    byChat.set(k, [...(byChat.get(k) ?? []), m]);
  }
  const by = (m: WaMessage): "менеджер" | "ИИ" | "рассылка" => (bcIds.has(m.messageId) ? "рассылка" : autoIds.has(m.messageId) || m.source === "assistant" ? "ИИ" : "менеджер");

  const linesOut = Array.from(new Set(messages.map((m) => m.line || ""))).map((line) => {
    const chats = Array.from(byChat.entries()).filter(([k]) => k.startsWith(`${line}|`)).map(([k, list]) => ({ key: k.split("|")[1], list: list.sort((a, b) => (a.at < b.at ? -1 : 1)) }));
    const own = chats.flatMap((c) => c.list.filter((m) => m.direction === "out" && by(m) === "менеджер"));
    const ownText = own.filter((m) => m.type === "text" && (m.text || "").trim());
    const incoming = chats.flatMap((c) => c.list.filter((m) => m.direction === "in"));
    const texts = ownText.map((m) => m.text.trim());
    const dup = new Map<string, number>();
    for (const t of texts) if (t.length >= 40) dup.set(t, (dup.get(t) ?? 0) + 1);
    const massTexts = Array.from(dup).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);
    const massCount = massTexts.reduce((s, [, n]) => s + n, 0);
    const style = parseStyleProfile(map[`${STYLE_SETTING_PREFIX}${line}`]);
    const manner = {
      ownMessages: own.length,
      avgChars: texts.length ? Math.round(texts.reduce((s, t) => s + t.length, 0) / texts.length) : 0,
      medianChars: q(texts.map((t) => t.length), 0.5),
      pctShort: pct(texts.filter((t) => t.length <= 20).length, texts.length),
      pctLong: pct(texts.filter((t) => t.length > 200).length, texts.length),
      pctQuestion: pct(texts.filter((t) => QUESTION.test(t)).length, texts.length),
      pctPrice: pct(texts.filter((t) => PRICE.test(t)).length, texts.length),
      pctEmoji: pct(texts.filter((t) => EMOJI.test(t)).length, texts.length),
      pctGreeting: pct(texts.filter((t) => GREET.test(t)).length, texts.length),
      pctKazakh: pct(texts.filter((t) => KZ.test(t)).length, texts.length),
      pctPolite: pct(texts.filter((t) => POLITE.test(t)).length, texts.length),
      pctSorry: pct(texts.filter((t) => SORRY.test(t)).length, texts.length),
      pctLowercase: pct(texts.filter((t) => /^[a-zа-яё]/.test(t)).length, texts.length),
      pctNoDot: pct(texts.filter((t) => !/[.!?…]$/.test(t)).length, texts.length),
      pctExclaim: pct(texts.filter((t) => t.includes("!")).length, texts.length),
      pctVoice: pct(own.filter((m) => m.type === "voice").length, own.length),
      pctPhoto: pct(own.filter((m) => m.type === "image" || m.type === "video").length, own.length),
      pctDocument: pct(own.filter((m) => m.type === "document").length, own.length),
      massMessages: massCount,
      pctMass: pct(massCount, texts.length),
      massExamples: massTexts.slice(0, 3).map(([t, n]) => ({ text: t.replace(/\s+/g, " ").slice(0, 160), count: n })),
      incomingVoice: pct(incoming.filter((m) => m.type === "voice").length, incoming.length),
      style: style ? { gradeWord: style.gradeWord, priceWord: style.priceWord, nameFirst: style.nameFirst, openers: style.topOpeners.slice(0, 6).map((x) => x[0]), phrases: style.topBigrams.slice(0, 8).map((x) => x[0]), samples: style.samples.slice(0, 10) } : null,
    };
    const ownHours = Array.from({ length: 24 }, () => 0);
    for (const m of own) ownHours[hourOf(m.at)]++;
    const activity = {
      byHour: ownHours,
      pctEvening: pct(own.filter((m) => hourOf(m.at) >= 19).length, own.length),
      pctNight: pct(own.filter((m) => hourOf(m.at) < 8).length, own.length),
      pctWeekend: pct(own.filter((m) => [0, 6].includes(wdOf(m.at))).length, own.length),
      activeDays: new Set(own.map((m) => new Date(Date.parse(m.at) + ALMATY_MS).toISOString().slice(0, 10))).size,
      perActiveDay: 0,
    };
    activity.perActiveDay = activity.activeDays ? Math.round(own.length / activity.activeDays) : 0;

    // динамика диалога
    const dyn = { chats: chats.length, msgsPerChat: [] as number[], ourShare: [] as number[], endedByUs: 0, endedByClient: 0, ourQuestionUnanswered: 0, clientGhosted: 0, spanDays: [] as number[], firstContactReply: [] as number[], toOrderHours: [] as number[], complaints: 0, complaintExamples: [] as { name: string; tail: string; text: string; at: string }[], aiAnsweredByHour: Array.from({ length: 24 }, () => ({ ai: 0, mgr: 0 })), aiFirstThenManager: 0, aiOnly: 0 };
    for (const c of chats) {
      const l = c.list; const who = whoIs(c.key);
      dyn.msgsPerChat.push(l.length);
      const ours = l.filter((m) => m.direction === "out").length;
      dyn.ourShare.push(ours / l.length);
      const last = l[l.length - 1];
      if (last.direction === "out") {
        dyn.endedByUs++;
        if (QUESTION.test((last.text || "").trim()) && by(last) !== "рассылка") dyn.ourQuestionUnanswered++;
        if (l.some((m) => m.direction === "in") && by(last) !== "рассылка" && now.getTime() - Date.parse(last.at) > 2 * 86400000) dyn.clientGhosted++;
      } else dyn.endedByClient++;
      dyn.spanDays.push((Date.parse(last.at) - Date.parse(l[0].at)) / 86400000);
      if (l[0].direction === "in") {
        const firstOut = l.find((m) => m.direction === "out" && by(m) !== "рассылка");
        if (firstOut) dyn.firstContactReply.push((Date.parse(firstOut.at) - Date.parse(l[0].at)) / 60000);
      }
      const firstIn = l.find((m) => m.direction === "in");
      if (firstIn) {
        const o = (ordersByKey.get(c.key) ?? []).filter((x) => x.at >= firstIn.at && Date.parse(x.at) - Date.parse(firstIn.at) <= 7 * 86400000).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
        if (o) dyn.toOrderHours.push((Date.parse(o.at) - Date.parse(firstIn.at)) / 3600000);
      }
      for (const m of l) if (m.direction === "in" && COMPLAINT.test(m.text || "") && !looksLikeRefusal(m.text)) { dyn.complaints++; if (dyn.complaintExamples.length < 6) dyn.complaintExamples.push({ name: who.name, tail: c.key.slice(-4), text: (m.text || "").replace(/\s+/g, " ").slice(0, 110), at: m.at.slice(0, 10) }); }
      let pending: WaMessage | null = null; let aiReplied = false; let mgrReplied = false;
      for (const m of l) {
        if (m.direction === "in") { if (!pending && needsReply(m)) pending = m; }
        else if (pending && by(m) !== "рассылка") { const h = hourOf(pending.at); if (by(m) === "ИИ") { dyn.aiAnsweredByHour[h].ai++; aiReplied = true; } else { dyn.aiAnsweredByHour[h].mgr++; mgrReplied = true; } pending = null; }
      }
      if (aiReplied && mgrReplied) dyn.aiFirstThenManager++;
      if (aiReplied && !mgrReplied) dyn.aiOnly++;
    }
    const dynamics = {
      chats: dyn.chats, msgsPerChatMedian: q(dyn.msgsPerChat, 0.5), ourShareMedian: q(dyn.ourShare.map((x) => x * 100), 0.5),
      endedByUs: dyn.endedByUs, endedByClient: dyn.endedByClient, ourQuestionUnanswered: dyn.ourQuestionUnanswered, clientGhosted: dyn.clientGhosted,
      spanDaysMedian: q(dyn.spanDays, 0.5), firstContactReplyMedian: q(dyn.firstContactReply, 0.5), firstContactReplyP90: q(dyn.firstContactReply, 0.9), firstContacts: dyn.firstContactReply.length,
      toOrderHoursMedian: q(dyn.toOrderHours, 0.5), toOrderCount: dyn.toOrderHours.length, toOrderSameDay: dyn.toOrderHours.filter((h) => h <= 24).length,
      complaints: dyn.complaints, complaintExamples: dyn.complaintExamples, aiAnsweredByHour: dyn.aiAnsweredByHour, aiFirstThenManager: dyn.aiFirstThenManager, aiOnly: dyn.aiOnly,
    };
    // отрывки: заявка, отказ, жалоба на молчание
    const excerpt = (list: WaMessage[], max = 10) => {
      const l = list.filter((m) => (m.text || "").trim() || m.type !== "text").slice(-max);
      return l.map((m) => `${m.at.slice(5, 16).replace("T", " ")} ${m.direction === "in" ? "Клиент" : by(m) === "ИИ" ? "ИИ" : by(m) === "рассылка" ? "Рассылка" : "Менеджер"}: ${(m.text || `[${m.type}]`).replace(/\s+/g, " ").slice(0, 150)}`);
    };
    const withOrder = chats.filter((c) => { const fi = c.list.find((m) => m.direction === "in"); return fi && (ordersByKey.get(c.key) ?? []).some((o) => o.at >= fi.at && Date.parse(o.at) - Date.parse(fi.at) <= 7 * 86400000); }).sort((a, b) => b.list.length - a.list.length);
    const withRefusal = chats.filter((c) => c.list.some((m) => m.direction === "in" && looksLikeRefusal(m.text)) && c.list.length >= 4).sort((a, b) => b.list.length - a.list.length);
    const withComplaint = chats.filter((c) => c.list.some((m) => m.direction === "in" && COMPLAINT.test(m.text || "")));
    const pick = (arr: typeof chats, i: number) => arr[Math.min(i, arr.length - 1)];
    const excerpts = [
      ...(withOrder.length ? [{ title: "Разговор, закончившийся заявкой", who: whoIs(pick(withOrder, Math.floor(withOrder.length / 2)).key), lines: excerpt(pick(withOrder, Math.floor(withOrder.length / 2)).list) }] : []),
      ...(withRefusal.length ? [{ title: "Разговор с отказом", who: whoIs(withRefusal[0].key), lines: excerpt(withRefusal[0].list) }] : []),
      ...(withComplaint.length ? [{ title: "Клиент жалуется на молчание", who: whoIs(withComplaint[0].key), lines: excerpt(withComplaint[0].list, 8) }] : []),
    ].map((e) => ({ ...e, who: { ...e.who, name: e.who.name || "без имени" } }));
    return { line, manager: lineOwner.get(line) || line, manner, activity, dynamics, excerpts, incomingTypes: count(incoming.map((m) => m.type)) };
  });
  const snapshot = { generatedAt: now.toISOString(), days, lines: linesOut };
  writeFileSync(out, JSON.stringify(snapshot, null, 1), "utf8");
  for (const l of linesOut) console.log(`${l.manager.padEnd(22)} своих ${l.manner.ownMessages} · ср. ${l.manner.avgChars} зн. · вопрос ${l.manner.pctQuestion} % · цена ${l.manner.pctPrice} % · голос ${l.manner.pctVoice} % · фото ${l.manner.pctPhoto} % · массовых ${l.manner.pctMass} % · вечер ${l.activity.pctEvening} % · вых ${l.activity.pctWeekend} % · жалоб ${l.dynamics.complaints} · наш вопрос без ответа ${l.dynamics.ourQuestionUnanswered} · до заявки медиана ${l.dynamics.toOrderHoursMedian} ч`);
  console.log(`JSON: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
