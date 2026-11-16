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
 * Если в карточке WhatsApp не записан — номер берётся из списка «Продажи бота»: тот единственный, с которого человек
 * пишет нам под своим именем (`aliases` — как ещё оно пишется, например латиницей).
 *
 *   npx tsx scripts/voice-offer-test.ts <json: { "names": ["Ержан", "Данияр"], "voice": "onyx", "aliases": { "Ержан": ["Yerzhan"] } }> [--yes]
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
import { settingsMap } from "../src/lib/repo/broadcasts";
import { digestPhones } from "../src/lib/morningDigest";
import { BOT_SALES_SETTING } from "../src/lib/botSalesAlert";
import { phoneKey } from "../src/lib/leads";
import { listWaLines } from "../src/lib/repo/waLines";
import { listWaMessages } from "../src/lib/repo/talks";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Нужен файл JSON с именами получателей");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { names: string[]; voice?: string; aliases?: Record<string, string[]> };
  const yes = process.argv.includes("--yes");

  const [users, map, lines, messages] = await Promise.all([listUsers(), settingsMap(), listWaLines(), listWaMessages({ lines: "all" })]);
  // Команда из «Настройки → Продажи бота в WhatsApp» (владелец, 03.10.2026: «Руслану, мне и Данияру»). В карточках
  // сотрудников WhatsApp у них не записан, поэтому чей номер чей — по имени, под которым человек сам пишет нам в WhatsApp.
  const team = Array.from(new Set(digestPhones(map[BOT_SALES_SETTING]).map((p) => waPhone(p)).filter(Boolean)));
  const cardOf = (p: string) => users.find((u) => phoneKey(u.phone) && phoneKey(u.phone) === phoneKey(p));
  const lineOf = (p: string) => lines.find((l) => l.phone && phoneKey(l.phone) === phoneKey(p));
  const waNames = (p: string) => Array.from(new Set(messages.filter((m) => m.direction === "in" && phoneKey(m.phone) === phoneKey(p)).map((m) => (m.senderName || "").trim()).filter(Boolean)));
  for (const p of team) {
    const line = lineOf(p);
    console.log(`Команда «Продажи бота» …${p.slice(-4)}: карточка — ${cardOf(p)?.name || "нет"}; линия — ${line ? users.find((u) => u.email.toLowerCase() === line.managerEmail.toLowerCase())?.name || line.label || line.code : "нет"}; в WhatsApp зовётся — ${waNames(p).join(" / ") || "не писал"}`);
  }
  const words = (v: string) => v.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const to: { name: string; phone: string; from: string }[] = [];
  for (const name of spec.names) {
    const found = users.filter((u) => u.active && u.role === ROLES.ADMIN && (u.name || "").trim().split(/\s+/)[0].toLowerCase() === name.trim().toLowerCase());
    if (found.length !== 1) throw new Error(`Администраторов по имени «${name}»: ${found.length} — нужен ровно один`);
    let phone = waPhone(found[0].phone);
    let from = "карточка сотрудника";
    if (!phone) {
      const spell = [name, ...(spec.aliases?.[name] || [])].map((v) => v.toLowerCase());
      const mine = team.filter((p) => waNames(p).some((n) => words(n).some((w) => spell.includes(w))));
      if (mine.length === 1) {
        phone = mine[0];
        from = `список «Продажи бота», в WhatsApp зовётся «${waNames(phone).join(" / ")}»`;
      } else throw new Error(`У сотрудника «${found[0].name}» не записан WhatsApp («Настройки → Сотрудники»), а в списке «Продажи бота» номеров с его именем: ${mine.length}`);
    }
    to.push({ name: found[0].name, phone, from });
  }
  if (new Set(to.map((t) => phoneKey(t.phone))).size !== to.length) throw new Error("Получатели совпали по номеру — не отправляю");

  const now = new Date();
  const [batches, settings, prices] = await Promise.all([listSellableBatches(), getSettings(), getCurrentPrices(localDayKey())]);
  const rows = Array.from(stockMap(inStore(batches, ""), settings, now).values()).map((r) => ({ ...r, price: priceFor(prices, r.flower, r.variety, r.grade) }));
  const text = voiceOfferText(pickVoiceOffers(rows));
  if (!text) throw new Error("На основном складе нечего предложить (нет позиций от 100 шт. с ценой)");
  console.log(`Текст (${text.length} зн.):\n${text}\n`);
  console.log(`Получатели: ${to.map((t) => `${t.name} …${t.phone.slice(-4)} (${t.from})`).join(", ")}`);
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
