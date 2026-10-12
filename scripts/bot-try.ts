/*
 * Что бот ответил бы на ВЫДУМАННЫЙ или восстановленный разговор — без отправки и записи.
 * Нужен, когда в памяти чата нужного места уже нет (память хранит последние реплики), а проверить
 * новое правило подсказки на живом случае надо.
 *
 *   npx tsx scripts/bot-try.ts <json>
 *   json: { "phone": "7747…", "context": [{ "role": "client"|"us", "text": "…" }], "cases": [{ "name": "…", "add": [{ "role": "client", "text": "…" }] }] }
 *
 * Номер — настоящий: «О клиенте» (заказы, счета, условия оплаты) бот видит как в жизни.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { botReply } from "../src/lib/botEngine";
import { botSettingsFrom } from "../src/lib/broadcast";
import { emptyBotChat, settingsMap } from "../src/lib/repo/broadcasts";

type Line = { role: "client" | "us"; text: string };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("нужен файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { phone: string; context: Line[]; cases: { name: string; add: Line[] }[] };
  const instructions = botSettingsFrom(await settingsMap(true)).instructions;
  const start = Date.now() - 3 * 3600000;
  for (const c of spec.cases) {
    const lines = [...spec.context, ...c.add];
    const chat = { ...emptyBotChat(spec.phone), context: lines.map((l, i) => ({ ...l, at: new Date(start + i * 60000).toISOString() })) };
    const d = await botReply(chat, instructions);
    console.log(`\n=== ${c.name}`);
    console.log(`клиент: ${c.add.filter((l) => l.role === "client").map((l) => l.text).join(" / ")}`);
    console.log(`бот: ${d.silent ? "[молчит]" : d.reply}`);
    if (d.alert) console.log(`тревога: ${d.alert}`);
    if (d.order.confirmed) console.log("[ОФОРМИЛ ЗАКАЗ]");
    if (d.cancelOrder) console.log(`[отмена заказа ${d.cancelOrder}]`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
