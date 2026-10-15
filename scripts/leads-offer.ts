import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Рассылка С НОМЕРА ЗЕМФИРЫ по её просроченным лидам (15.10.2026, владелец: «сделай рассылку по всем просроченным лидам
 * с предложением купить хризу 4-й категории; клиенты сами писали на этот номер — можем ли увеличить частоту?»).
 *
 * Кому: открытые лиды без карточки клиента, следующее касание раньше сегодня, мобильный номер, есть переписка на номере
 * Земфиры, не отписались. НЕ шлём, если клиент написал последним (ждёт живого ответа — список печатается для Земфиры)
 * или в чате писали меньше 2 часов назад (идёт разговор). Имя-заглушка «Клиент WhatsApp NNNN» в обращение не идёт.
 *
 * Текст — JSON в UTF-8 { "title": "…", "text": "… {имя} … {цена} … {опт_от} … {опт_цена} … {склад} …" }: цена — самая
 * частая цена категории по сортам на складе (прайс), опт — из настройки распродажи `SalesPush`, склад — живое, округлено.
 * Без --yes — показ (кому, кого пропускаем и почему, готовый текст). С --yes — рассылка «идёт» с `Line = leads`, номер —
 * в _private/broadcast-leads.txt; отправку ведёт `broadcast-run.ts --id-file ..\_private\broadcast-leads.txt`.
 *
 *   npx tsx scripts/leads-offer.ts <json> [--yes]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listLeads } from "../src/lib/repo/leads";
import { listWaMessages } from "../src/lib/repo/talks";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { createBroadcast, listBroadcasts, optedOutKeys, settingsMap } from "../src/lib/repo/broadcasts";
import { priceFor } from "../src/lib/priceList";
import { computeBatchStorageInfo } from "../src/lib/shelfLife";
import { isClosedStage, phoneKey } from "../src/lib/leads";
import { mergeMessages } from "../src/lib/whatsapp";
import { LEADS_LINE, greetingName, personalize, waPhone } from "../src/lib/broadcast";
import { parsePush, pushItemFor, SALES_PUSH_SETTING } from "../src/lib/salesPush";
import { localDayKey } from "../src/lib/timezone";

const FLOWER = "chrysanthemum";
const GRADE = "Четвёртая";
const OWNER = "y.sadakbayev@gmail.com";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ");

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("нужен файл JSON с title и text");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { title: string; text: string };
  const apply = process.argv.includes("--yes");
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.BATCHES, SHEET_TABS.SETTINGS, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.BROADCASTS, SHEET_TABS.BOT_CHATS]);
  const now = new Date();
  const today = localDayKey(now);
  const [leads, msgs, batches, shelf, prices, map, opted, broadcasts] = await Promise.all([
    listLeads({ fresh: true }),
    listWaMessages({ lines: "all" }),
    listBatches(),
    getSettings(),
    getCurrentPrices(),
    settingsMap(),
    optedOutKeys(),
    listBroadcasts(true),
  ]);

  // --- Цена и склад 4-й категории ---
  const byVariety = new Map<string, number>();
  for (const b of batches) {
    if (b.flowerType !== FLOWER || b.grade !== GRADE || !(b.quantityRemaining > 0)) continue;
    if (computeBatchStorageInfo(b, shelf, now).status === "critical") continue;
    byVariety.set(b.variety, (byVariety.get(b.variety) ?? 0) + b.quantityRemaining);
  }
  const live = Array.from(byVariety.values()).reduce((s, v) => s + v, 0);
  const priceCount = new Map<number, number>();
  for (const [v, q] of Array.from(byVariety.entries())) {
    const p = priceFor(prices, FLOWER, v, GRADE);
    if (p > 0) priceCount.set(p, (priceCount.get(p) ?? 0) + q);
  }
  const price = Array.from(priceCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? priceFor(prices, FLOWER, "", GRADE);
  const push = pushItemFor(parsePush(map[SALES_PUSH_SETTING]), FLOWER, GRADE);
  console.log(`Хризантема 4 кат.: живое ${n(live)} шт. по сортам: ${Array.from(byVariety.entries()).sort((a, b) => b[1] - a[1]).map(([v, q]) => `${v} ${n(q)} (${priceFor(prices, FLOWER, v, GRADE) || "нет цены"})`).join(", ")}`);
  console.log(`Цена для текста: ${price || "НЕТ"} ₸; от объёма: ${push && push.bulkFrom ? `от ${n(push.bulkFrom)} шт. — ${push.bulkPrice} ₸` : "не задано"}`);
  if (!price) throw new Error("нет цены 4-й категории в прайсе — текст не собрать");
  const stockWord = live >= 1000 ? `более ${n(Math.floor(live / 1000) * 1000)}` : n(live);
  let text = spec.text
    .replace(/\{\s*цена\s*\}/gi, n(price))
    .replace(/\{\s*опт_от\s*\}/gi, push?.bulkFrom ? n(push.bulkFrom) : "")
    .replace(/\{\s*опт_цена\s*\}/gi, push?.bulkPrice ? n(push.bulkPrice) : "")
    .replace(/\{\s*склад\s*\}/gi, stockWord);
  if (/\{\s*(цена|опт_от|опт_цена|склад)\s*\}/i.test(text)) throw new Error("не все метки заполнились");
  text = text.trim();

  // --- Кому ---
  const chatOf = new Map<string, typeof msgs>();
  for (const m of msgs) {
    if (m.line !== LEADS_LINE) continue;
    const k = phoneKey(m.phone);
    if (k) chatOf.set(k, [...(chatOf.get(k) ?? []), m]);
  }
  const already = new Set<string>();
  for (const b of broadcasts) if (b.title === spec.title && b.status !== "cancelled") already.add(b.broadcastId);
  if (already.size) throw new Error(`рассылка «${spec.title}» уже заведена (${Array.from(already).join(", ")}) — второй раз не завожу`);

  const take: { phone: string; name: string; kind: string; refId: string; managerEmail: string }[] = [];
  const skip: Record<string, string[]> = {};
  const add = (why: string, who: string) => (skip[why] = [...(skip[why] ?? []), who]);
  const seen = new Set<string>();
  const overdue = leads.filter((l) => !isClosedStage(l.stage) && !l.clientId && l.nextTouchAt && l.nextTouchAt.slice(0, 10) < today);
  for (const l of overdue) {
    const phone = waPhone(l.phone);
    const k = phoneKey(phone);
    const label = `${l.name} …${(l.phone || "").replace(/\D/g, "").slice(-4)}`;
    if (!phone) { add("нет мобильного", label); continue; }
    if (seen.has(k)) { add("номер повторяется", label); continue; }
    if (opted.has(k)) { add("отписался", label); continue; }
    const chat = mergeMessages(chatOf.get(k) ?? []);
    if (!chat.length) { add("нет переписки на номере Земфиры", label); continue; }
    const last = chat[chat.length - 1];
    if (last.direction === "in") { add("клиент написал последним — ждёт ответа Земфиры", `${label}: «${(last.text || `[${last.type}]`).slice(0, 60)}»`); continue; }
    if (now.getTime() - Date.parse(last.at) < 2 * 3600 * 1000) { add("переписка меньше 2 часов назад", label); continue; }
    seen.add(k);
    const placeholder = /^Клиент WhatsApp/i.test(l.name.trim());
    take.push({ phone, name: placeholder ? "" : greetingName(l.contactPerson, l.name), kind: "lead", refId: l.leadId, managerEmail: l.managerEmail });
  }

  console.log(`\nПросроченных лидов: ${overdue.length}; уйдёт: ${take.length}`);
  for (const [why, list] of Object.entries(skip)) {
    console.log(`  не шлём — ${why}: ${list.length}`);
    if (why.startsWith("клиент написал")) for (const x of list) console.log(`    ${x}`);
  }
  console.log(`\nТекст (с именем / без имени):\n---\n${personalize(text, "Айгерим", false)}\n---\n${personalize(text, "", false)}\n---`);
  const hours = Math.ceil(take.length / 30);
  console.log(`Темп номера Земфиры: 40–90 с, до 30 в час, 10:00–19:00 → около ${hours} ч.`);

  if (!apply) return console.log("\nТолько показ. Завести и запустить: --yes");
  if (!take.length) return console.log("Слать некому.");
  const id = await createBroadcast({
    createdByEmail: OWNER,
    title: spec.title,
    text,
    fileId: "",
    fileName: "",
    audience: `Просроченные лиды Земфиры (${take.length}), с её номера`,
    recipients: take,
    line: LEADS_LINE,
    status: "sending",
  });
  writeFileSync("../_private/broadcast-leads.txt", id, "utf8");
  console.log(`\nЗаведена и запущена: ${id} (номер Земфиры). Номер — в _private/broadcast-leads.txt`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
