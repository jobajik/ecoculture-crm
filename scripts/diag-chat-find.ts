/*
 * Найти переписку по куску текста и показать её так, как её видит CRM и ИИ-помощник (16.11.2026: владелец прислал
 * снимок — клиентка наговорила голосом «вторая категория», помощник ответил «четвёртая категория»; «почему ты
 * неправильно считываешь потребности клиентов?»). Ничего не меняет. Печатает по каждому найденному чату: номер линии,
 * хвост телефона, последние сообщения с видом (текст / голосовое — у голосового печатается РАСШИФРОВКА, по которой
 * отвечал помощник), записи журнала помощника и цены на названный цветок.
 *
 *   npx tsx scripts/diag-chat-find.ts <файл с куском текста> [часов назад, по умолчанию 24] [цветок сорт для цен]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { listWaMessages } from "../src/lib/repo/talks";
import { listAssistantLog } from "../src/lib/repo/waLines";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { mergeMessages } from "../src/lib/whatsapp";

const almaty = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 5 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : String(iso).slice(0, 16);
};
const flat = (text: string, max: number) => (text || "").replace(/\s+/g, " ").slice(0, max);

async function main() {
  const [file, hoursArg, flower, variety] = process.argv.slice(2);
  if (!file) throw new Error("Нужен файл с куском текста сообщения");
  const needle = readFileSync(file, "utf-8").replace(/^﻿/, "").trim().toLowerCase();
  const since = Date.now() - (Number(hoursArg) || 24) * 3600_000;
  const all = await listWaMessages({ lines: "all" });
  const hits = all.filter((m) => Date.parse(m.at) >= since && (m.text || "").toLowerCase().includes(needle));
  const chats = new Map<string, { line: string; phone: string }>();
  for (const m of hits) chats.set(`${m.line || ""}|${m.phone}`, { line: m.line || "", phone: m.phone });
  console.log(`Ищу «${needle.slice(0, 60)}» за ${Number(hoursArg) || 24} ч: сообщений ${hits.length}, чатов ${chats.size}`);
  const log = await listAssistantLog();

  for (const { line, phone } of chats.values()) {
    const chat = mergeMessages(all.filter((m) => (m.line || "") === line && m.phone === phone)).filter((m) => Date.parse(m.at) >= Date.now() - 4 * 86400_000);
    console.log(`\n=== линия «${line || "основной"}» · …${phone.slice(-4)} · сообщений за 4 дня: ${chat.length} ===`);
    for (const m of chat.slice(-30)) {
      console.log(`${almaty(m.at)} ${m.direction === "in" ? "КЛИЕНТ" : "мы    "} [${m.type}/${m.source}${m.mediaUrl ? "/файл" : ""}] ${flat(m.text, 500) || "(пусто)"}`);
    }
    const rows = log.filter((r) => r.line === line && r.phone.slice(-10) === phone.slice(-10) && Date.parse(r.at) >= Date.now() - 4 * 86400_000);
    console.log(`--- журнал помощника: ${rows.length}`);
    for (const r of rows.slice(-15)) console.log(`${almaty(r.at)} [${r.kind}] ${flat(r.text, 300)}${r.note ? ` · записка: ${flat(r.note, 300)}` : ""}`);
  }

  if (flower) {
    const prices = await getCurrentPrices();
    console.log(`\n--- цены сегодня: ${flower} ${variety || ""}`);
    for (const p of prices.values()) {
      if (p.flowerType !== flower) continue;
      if (variety && p.variety && p.variety.toLowerCase() !== variety.toLowerCase()) continue;
      console.log(`  ${p.variety || "все сорта"} · ${p.grade}: ${p.price}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
