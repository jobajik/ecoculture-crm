import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Как пишет каждый менеджер со своего номера (09.11.2026, владелец: «изучи повадки, черты в переписках и пиши так,
 * чтобы это было правдоподобно»). Берёт исходящие сообщения с номеров менеджеров (`WaLines`), которые написал САМ
 * менеджер с телефона: не помощник, не дожим, не отправка из CRM (`AssistantLog`), не рассылка (`BroadcastRecipients`),
 * не сотрудникам. Считает черты (длина, приветствия, смайлики, регистр, точки, казахский, частые слова и обороты) и
 * выписывает примеры; для самых ценных постоянников — хвост переписки. Пишет JSON, ничего не меняет.
 *
 *   npx tsx scripts/diag-manager-style.ts <файл.json> [дней, 60]
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listWaMessages } from "../src/lib/repo/talks";
import { listWaLines, listAssistantLog } from "../src/lib/repo/waLines";
import { listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { listUsers } from "../src/lib/repo/users";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { phoneKey } from "../src/lib/leads";
import { mergeMessages } from "../src/lib/whatsapp";
import { computeHabits } from "../src/lib/clientHabitsRunner";
import { localDayKey } from "../src/lib/timezone";
import type { WaMessage } from "../src/lib/types";

const STOP = new Set(
  "и в на с по не что это как я вы мы а но у за из для до от то же бы ли или если все всё есть был была были будет можно нужно надо там тут вот так ну да нет ок хорошо спасибо пожалуйста здравствуйте добрый день утро вечер сәлеметсіз бе рахмет жақсы иә жоқ".split(/\s+/)
);
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const KZ = /[әғқңөұүһі]/i;
const GREET = /^(здравствуйте|добрый|доброе|салем|сәлем|сәлеметсіз|ассалаумағалейкум|привет|здравствуй)/i;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const top = (m: Map<string, number>, n: number) => Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n);

function profile(msgs: WaMessage[]) {
  const texts = msgs.map((m) => (m.text || "").trim()).filter((t) => t.length >= 2);
  const words = new Map<string, number>();
  const bigrams = new Map<string, number>();
  const openers = new Map<string, number>();
  const closers = new Map<string, number>();
  let emoji = 0, lower = 0, noDot = 0, kz = 0, greet = 0, excl = 0, yo = 0, question = 0;
  for (const t of texts) {
    if (EMOJI.test(t)) emoji++;
    if (/^[a-zа-яё]/.test(t)) lower++;
    if (!/[.!?…]$/.test(t)) noDot++;
    if (KZ.test(t)) kz++;
    if (GREET.test(t)) greet++;
    if (t.includes("!")) excl++;
    if (/ё/i.test(t)) yo++;
    if (t.includes("?")) question++;
    const ws = t.toLowerCase().replace(/[^a-zа-яёәғқңөұүһі0-9\s-]/gi, " ").split(/\s+/).filter(Boolean);
    openers.set(ws.slice(0, 2).join(" "), (openers.get(ws.slice(0, 2).join(" ")) ?? 0) + 1);
    closers.set(ws.slice(-2).join(" "), (closers.get(ws.slice(-2).join(" ")) ?? 0) + 1);
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) words.set(w, (words.get(w) ?? 0) + 1);
      if (i + 1 < ws.length) {
        const b = `${w} ${ws[i + 1]}`;
        if (!STOP.has(w) || !STOP.has(ws[i + 1])) bigrams.set(b, (bigrams.get(b) ?? 0) + 1);
      }
    }
  }
  const n = texts.length;
  return {
    messages: n,
    medianChars: median(texts.map((t) => t.length)),
    p90Chars: texts.length ? [...texts.map((t) => t.length)].sort((a, b) => a - b)[Math.floor(texts.length * 0.9)] : 0,
    pctEmoji: pct(emoji, n),
    pctLowercaseStart: pct(lower, n),
    pctNoFinalDot: pct(noDot, n),
    pctKazakh: pct(kz, n),
    pctGreeting: pct(greet, n),
    pctExclamation: pct(excl, n),
    pctYo: pct(yo, n),
    pctQuestion: pct(question, n),
    topWords: top(words, 40),
    topBigrams: top(bigrams, 30).filter(([, c]) => c >= 3),
    topOpeners: top(openers, 15).filter(([, c]) => c >= 3),
    topClosers: top(closers, 15).filter(([, c]) => c >= 3),
  };
}

async function main() {
  const out = process.argv.slice(2).find((a) => !a.startsWith("--")) || "manager-style.json";
  const days = Number(process.argv[3]) || 60;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.USERS, SHEET_TABS.SETTINGS]);
  const [messages, lines, log, recipients, users, settings] = await Promise.all([
    listWaMessages({ lines: "all" }),
    listWaLines(),
    listAssistantLog(),
    listRecipients(true),
    listUsers(),
    settingsMap(),
  ]);
  const ours = await ourPhoneKeys(settings);
  const autoIds = new Set(log.filter((r) => r.kind !== "note").map((r) => r.messageId));
  const bcIds = new Set(recipients.map((r) => r.messageId).filter(Boolean));
  const nameOf = new Map(users.map((u) => [u.email, u.name]));
  const habits = await computeHabits(localDayKey());

  const report: Record<string, unknown> = { at: new Date().toISOString(), days, managers: [] as unknown[] };
  for (const line of lines.filter((l) => l.active && l.managerEmail)) {
    const mine = messages.filter((m) => m.line === line.code && m.at >= since && !ours.has(phoneKey(m.phone)));
    const own = mine.filter((m) => m.direction === "out" && m.type === "text" && !autoIds.has(m.messageId) && !bcIds.has(m.messageId) && m.source !== "assistant");
    const auto = mine.filter((m) => m.direction === "out" && (autoIds.has(m.messageId) || bcIds.has(m.messageId)));
    const prof = profile(own);
    const pool = own.map((m) => (m.text || "").trim()).filter((t) => t.length >= 15 && t.length <= 320);
    const samples: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < pool.length && samples.length < 45; i++) {
      const t = pool[Math.floor((i * 7919) % pool.length)];
      if (!seen.has(t)) {
        seen.add(t);
        samples.push(t);
      }
    }
    const regulars = habits.filter((h) => h.regular && h.managerEmail === line.managerEmail).sort((a, b) => b.avgAmount * (7 / Math.max(1, b.medianGapDays)) - a.avgAmount * (7 / Math.max(1, a.medianGapDays)));
    const chats = regulars.slice(0, 4).map((h) => {
      const key = phoneKey(h.phone);
      const chat = mergeMessages(mine.filter((m) => phoneKey(m.phone) === key)).slice(-14);
      return {
        client: h.name,
        tail: "…" + h.phone.slice(-4),
        orders: h.orders,
        gap: h.medianGapDays,
        weekday: h.weekday,
        usual: h.usual.map((u) => `${u.flowerType} ${u.variety} ${u.grade} ×${u.qty}`),
        chat: chat.map((m) => `${m.at.slice(5, 16).replace("T", " ")} ${m.direction === "in" ? "клиент" : autoIds.has(m.messageId) ? "ИИ" : bcIds.has(m.messageId) ? "рассылка" : "менеджер"}: ${(m.text || `[${m.type}]`).slice(0, 220)}`),
      };
    });
    (report.managers as unknown[]).push({
      line: line.code,
      manager: nameOf.get(line.managerEmail) || line.managerEmail,
      assistant: line.assistant,
      totalOut: mine.filter((m) => m.direction === "out").length,
      ownMessages: own.length,
      autoMessages: auto.length,
      chatsWithOwn: new Set(own.map((m) => phoneKey(m.phone))).size,
      profile: prof,
      samples,
      regularsChats: chats,
    });
    console.log(`${nameOf.get(line.managerEmail) || line.code}: своих сообщений ${own.length} (из ${mine.filter((m) => m.direction === "out").length} исходящих, ИИ и рассылки ${auto.length}) · медиана ${prof.medianChars} зн. · смайлики ${prof.pctEmoji} % · с маленькой буквы ${prof.pctLowercaseStart} % · без точки ${prof.pctNoFinalDot} % · казахский ${prof.pctKazakh} % · приветствие ${prof.pctGreeting} %`);
    console.log(`  слова: ${prof.topWords.slice(0, 15).map(([w, c]) => `${w} ${c}`).join(", ")}`);
    console.log(`  обороты: ${prof.topBigrams.slice(0, 10).map(([w, c]) => `«${w}» ${c}`).join(", ")}`);
    for (const s of samples.slice(0, 6)) console.log(`  › ${s.replace(/\n/g, " / ")}`);
  }
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nJSON: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
