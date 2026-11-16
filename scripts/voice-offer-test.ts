import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Тестовое голосовое предложение — сотрудникам, не клиентам (16.11.2026, владелец: «отправь мне и Данияру в качестве
 * теста»). Текст собирает код из склада и прайса (`voiceOffer.ts`), озвучивает стандартный синтетический голос OpenAI
 * (не копия чьего-то голоса), аудио уходит с основного номера, следом — текст: что это тест и что голос сгенерирован.
 * Получатели — только администраторы из «Настройки → Сотрудники», названные по имени в файле; у каждого должен быть
 * записан WhatsApp. Без --yes — только показ: текст и кому ушло бы.
 *
 *   npx tsx scripts/voice-offer-test.ts <json: { "names": ["Ержан", "Данияр"], "voice": "onyx" }> [--yes]
 */
import { readFileSync } from "node:fs";
process.env.NEXTAUTH_URL = "https://www.crm-ecoculture.kz"; // ссылка на аудио — на боевой сайт
import { listUsers } from "../src/lib/repo/users";
import { listSellableBatches } from "../src/lib/repo/sellable";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { appendFilePart } from "../src/lib/repo/broadcasts";
import { priceFor } from "../src/lib/priceList";
import { stockMap } from "../src/lib/botKnowledge";
import { inStore } from "../src/lib/officeStore";
import { localDayKey } from "../src/lib/timezone";
import { waPhone } from "../src/lib/broadcast";
import { greenConfig, sendFileByUrl, sendText } from "../src/lib/greenApi";
import { publicFileUrl } from "../src/lib/waFileSign";
import { speakText } from "../src/lib/openai";
import { pickVoiceOffers, voiceOfferText, voiceTestNote } from "../src/lib/voiceOffer";
import { ROLES } from "../src/lib/constants";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Нужен файл JSON с именами получателей");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { names: string[]; voice?: string };
  const yes = process.argv.includes("--yes");

  const users = await listUsers();
  const to: { name: string; phone: string }[] = [];
  for (const name of spec.names) {
    const found = users.filter((u) => u.active && u.role === ROLES.ADMIN && (u.name || "").trim().split(/\s+/)[0].toLowerCase() === name.trim().toLowerCase());
    if (found.length !== 1) throw new Error(`Администраторов по имени «${name}»: ${found.length} — нужен ровно один`);
    const phone = waPhone(found[0].phone);
    if (!phone) throw new Error(`У сотрудника «${found[0].name}» не записан WhatsApp («Настройки → Сотрудники»)`);
    to.push({ name: found[0].name, phone });
  }

  const now = new Date();
  const [batches, settings, prices] = await Promise.all([listSellableBatches(), getSettings(), getCurrentPrices(localDayKey())]);
  const rows = Array.from(stockMap(inStore(batches, ""), settings, now).values()).map((r) => ({ ...r, price: priceFor(prices, r.flower, r.variety, r.grade) }));
  const text = voiceOfferText(pickVoiceOffers(rows));
  if (!text) throw new Error("На основном складе нечего предложить (нет позиций от 100 шт. с ценой)");
  console.log(`Текст (${text.length} зн.):\n${text}\n`);
  console.log(`Получатели: ${to.map((t) => `${t.name} …${t.phone.slice(-4)}`).join(", ")}`);
  if (!yes) return console.log("\nБез --yes ничего не отправлено.");

  const cfg = greenConfig();
  if (!cfg) throw new Error("Основной номер WhatsApp не подключён");
  const speech = await speakText(text, { voice: spec.voice, style: "Говори по-русски, тепло и по-деловому, как менеджер, который предлагает свежие цветы постоянному клиенту. Спокойный темп, цены произноси чётко." });
  console.log(`Озвучено: модель ${speech.model}, голос ${speech.voice}, ${Math.round(speech.data.length / 1024)} КБ`);
  const name = "predlozhenie-ecoculture.mp3";
  const saved = await appendFilePart({ fileId: "", createdByEmail: "voice-offer-test", name, mime: "audio/mpeg", size: speech.data.length, partOffset: 0, data: speech.data.toString("base64") });
  const url = publicFileUrl(process.env.NEXTAUTH_URL as string, saved.fileId, name);
  const check = await fetch(url);
  console.log(`Файл ${saved.fileId}: сайт отдаёт ${check.status}, ${check.headers.get("content-type")}, ${check.headers.get("content-length")} байт`);
  if (!check.ok) throw new Error("Сайт не отдал аудио — не отправляю");
  for (const t of to) {
    const audioId = await sendFileByUrl(cfg, t.phone, url, name, "");
    const noteId = await sendText(cfg, t.phone, voiceTestNote(text), { linkPreview: false });
    console.log(`${t.name} …${t.phone.slice(-4)}: аудио ${audioId ? "ушло" : "?"}, текст ${noteId ? "ушёл" : "?"}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
