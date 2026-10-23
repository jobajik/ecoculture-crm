import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Где мы писали фразу (23.10.2026, владелец со снимком: «Поставлю 100 шт Altaj, третья категория, по 190 ₸ — почему тройку
 * по такой цене?»): по всем номерам — чаты за N дней, где в нашем сообщении есть слово; переписка вокруг (кто писал:
 * помощник, дожим, человек с телефона или из CRM), цены прайса по позиции, распродажа и строки указаний владельца с этим
 * словом. Телефоны — последние 4 цифры. Ничего не меняет.
 *
 *   npx tsx scripts/diag-find-phrase.ts <слово> [дней] [цветок] [сорт]
 */
import { listWaMessages } from "../src/lib/repo/talks";
import { listAssistantLog } from "../src/lib/repo/waLines";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { mergeMessages, messageText } from "../src/lib/whatsapp";
import { phoneKey } from "../src/lib/leads";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const [word, daysRaw, flower = "chrysanthemum", variety = "Altaj"] = process.argv.slice(2);
  if (!word) throw new Error("нужно слово");
  const days = Number(daysRaw) || 3;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [messages, log, map, prices] = await Promise.all([listWaMessages({ lines: "all", fresh: true }), listAssistantLog({ fresh: true }), settingsMap(true), getCurrentPrices(localDayKey())]);
  const kindOf = new Map(log.map((r) => [r.messageId, r.kind]));
  const hits = messages.filter((m) => m.direction === "out" && m.at >= since && messageText(m).includes(word));
  const chats = new Set(hits.map((m) => `${m.line}|${phoneKey(m.phone)}`));
  console.log(`«${word}» в наших сообщениях за ${days} дн.: ${hits.length}, чатов ${chats.size}`);
  for (const c of Array.from(chats)) {
    const [line, key] = c.split("|");
    const chat = mergeMessages(messages.filter((m) => m.line === line && phoneKey(m.phone) === key && m.at >= since));
    console.log(`\n=== номер «${line || "основной"}» · клиент …${key.slice(-4)} ===`);
    for (const m of chat.slice(-30)) {
      const who = m.direction === "in" ? "КЛИЕНТ " : kindOf.get(m.messageId) === "auto" ? "помощн." : kindOf.get(m.messageId) === "nudge" ? "дожим  " : kindOf.get(m.messageId) === "crm" ? "из CRM " : m.source === "api" ? "бот/API" : "телефон";
      console.log(`${m.at.slice(5, 16)}Z ${who} [${m.source}] ${messageText(m).replace(/\s+/g, " ").slice(0, 260)}`);
    }
    const notes = log.filter((r) => r.line === line && phoneKey(r.phone) === key && r.at >= since && r.kind === "note");
    for (const n of notes) console.log(`  записка ${n.at.slice(5, 16)}Z: ${(n.note || n.text).replace(/\s+/g, " ").slice(0, 200)}`);
  }
  console.log(`\nПрайс ${flower} ${variety} на сегодня:`);
  for (const r of Array.from(prices.values()).filter((r) => r.flowerType === flower && (!r.variety || r.variety === variety)))
    console.log(`  ${r.grade.padEnd(12)} ${(r.variety || "(все сорта)").padEnd(12)} ${r.price}  с ${r.date}`);
  console.log(`\nSalesPush: ${map.SalesPush || "—"}`);
  for (const [k, v] of Object.entries(map)) {
    if (!/Instructions|ManagerProfiles/i.test(k)) continue;
    const lines = String(v).split(/\n/).filter((l) => l.includes(word) || /190/.test(l));
    if (lines.length) console.log(`${k}:\n${lines.map((l) => `  ${l.slice(0, 300)}`).join("\n")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
