/*
 * Что бот ответил бы на ВЫДУМАННЫЙ или восстановленный разговор — без отправки и записи.
 * Нужен, когда в памяти чата нужного места уже нет (память хранит последние реплики), а проверить
 * новое правило подсказки на живом случае надо.
 *
 *   npx tsx scripts/bot-try.ts <json>
 *   json: { "phone": "7747…", "context": [{ "role": "client"|"us", "text": "…" }], "cases": [{ "name": "…", "add": [{ "role": "client", "text": "…" }] }] }
 *
 * Номер — настоящий: «О клиенте» (заказы, счета, условия оплаты) бот видит как в жизни. Вместо номера можно дать
 * "phoneTail" — последние цифры: номер найдётся в памяти бота (16.11.2026). Ключ --about печатает блок «О клиенте»
 * (номера в нём — хвостом).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { botReply } from "../src/lib/botEngine";
import { botSettingsFrom } from "../src/lib/broadcast";
import { emptyBotChat, listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { botClientContext } from "../src/lib/botOrderRunner";
import { listBotPhotos } from "../src/lib/repo/botPhotos";
import { isInfoPhoto, photoLabel, pickItemPhoto } from "../src/lib/botPhotos";

type Line = { role: "client" | "us"; text: string };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("нужен файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { phone: string; phoneTail?: string; context: Line[]; cases: { name: string; add: Line[] }[] };
  if (!spec.phone && spec.phoneTail) {
    const tail = spec.phoneTail.replace(/\D/g, "");
    const found = (await listBotChats(true)).filter((c) => c.phone.replace(/\D/g, "").endsWith(tail));
    if (found.length !== 1) throw new Error(`В памяти бота номеров на …${tail}: ${found.length} — нужен ровно один`);
    spec.phone = found[0].phone;
  }
  if (process.argv.includes("--about")) {
    console.log("=== О клиенте (как видит бот)");
    console.log((await botClientContext(spec.phone)).replace(/\+?\d[\d ()-]{8,}\d/g, (m) => `…${m.replace(/\D/g, "").slice(-4)}`));
  }
  const instructions = botSettingsFrom(await settingsMap(true)).instructions;
  const start = Date.now() - 3 * 3600000;
  const photos = await listBotPhotos(true);
  for (const c of spec.cases) {
    const lines = [...spec.context, ...c.add];
    const chat = { ...emptyBotChat(spec.phone), context: lines.map((l, i) => ({ ...l, at: new Date(start + i * 60000).toISOString() })) };
    const d = await botReply(chat, instructions);
    console.log(`\n=== ${c.name}`);
    console.log(`клиент: ${c.add.filter((l) => l.role === "client").map((l) => l.text).join(" / ")}`);
    console.log(`бот: ${d.silent ? "[молчит]" : d.reply}`);
    if (d.photo.flowerType) {
      // Как в botAct: фото позиции, ответ — подписью. Инфографику этому номеру считаем ещё не отправленной.
      const pic = pickItemPhoto(photos, d.photo, lines.map((l) => l.text).join("\n"));
      console.log(`фото: ${photoLabel(d.photo)} → ${pic ? `${pic.photoId} (${isInfoPhoto(pic) ? "инфографика" : "живое"}: ${photoLabel(pic)})` : "подходящего фото нет — уйдёт текстом"}`);
    } else if (d.catalog) console.log(`[каталог: ${d.catalog}]`);
    else if (!d.silent) console.log("фото: нет");
    if (d.alert) console.log(`тревога: ${d.alert}`);
    if (d.invoiceAgain || d.kaspiPhone) console.log(`[просит перевыставить счёт${d.kaspiPhone ? " на другой номер" : ""}]`);
    if (d.order.confirmed) console.log("[ОФОРМИЛ ЗАКАЗ]");
    if (d.cancelOrder) console.log(`[отмена заказа ${d.cancelOrder}]`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
