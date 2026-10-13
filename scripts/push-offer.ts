/*
 * Личное предложение распродаваемой позиции тем, кто её уже покупал (13.10.2026, владелец: «предложить прошлым
 * покупателям» 4-ю категорию хризантемы). Сообщение уходит с рабочего номера и пишется в память бота
 * (`sendBotMessage`), поэтому на ответ клиента бот отвечает сам, как на рассылку.
 *
 *   npx tsx scripts/push-offer.ts <json> [--send]
 *   json: { "flowerType": "chrysanthemum", "grade": "Четвёртая", "days": 45,
 *           "text": "Здравствуйте, {имя}! … {опт} …", "max": 10 }
 *
 * Кому: клиенты (не наши магазины, не отписавшиеся, не сотрудники), у которых за `days` дней была заявка с этой
 * позицией; один номер — один раз; кто сам писал нам за последние сутки — пропускаем (с ним уже разговор).
 * Без --send — только показ: кто и какой текст. С --send — по одному, пауза 40–80 с, не больше `max`.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { BOT_MODES, greetingName, personalize, waPhone } from "../src/lib/broadcast";
import { isNotASale } from "../src/lib/orderKind";
import { localDayKey } from "../src/lib/timezone";
import { phoneKey } from "../src/lib/leads";
import { staffPhoneKeys } from "../src/lib/botSalesAlert";
import { sendBotMessage } from "../src/lib/botFollowUp";
import { listWaMessages } from "../src/lib/repo/talks";

interface Spec {
  flowerType: string;
  grade: string;
  days?: number;
  text: string;
  max?: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

async function main() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")) as Spec;
  const send = process.argv.includes("--send");
  const days = spec.days ?? 45;
  const max = Math.min(spec.max ?? 10, 20);
  const from = localDayKey(new Date(Date.now() - days * 86_400_000));
  const [orders, chats, map, messages] = await Promise.all([listOrdersWithItems(), listBotChats(true), settingsMap(), listWaMessages()]);
  const staff = staffPhoneKeys(map);
  const optOut = new Set(chats.filter((c) => c.mode === BOT_MODES.OPT_OUT).map((c) => phoneKey(c.phone)));
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const talking = new Set(messages.filter((m) => m.direction === "in" && m.at >= dayAgo).map((m) => phoneKey(m.phone)));

  const people = new Map<string, { phone: string; name: string; stems: number; last: string }>();
  for (const o of orders) {
    if (o.status === "cancelled" || !o.createdAt || isNotASale(o) || o.retail) continue;
    const day = localDayKey(new Date(o.createdAt));
    if (day < from) continue;
    const stems = o.items.filter((i) => i.flowerType === spec.flowerType && norm(i.grade) === norm(spec.grade)).reduce((s, i) => s + i.quantity, 0);
    if (!stems) continue;
    const phone = waPhone(o.clientPhone);
    if (!phone) continue;
    const key = phoneKey(phone);
    const cur = people.get(key) ?? { phone, name: o.clientName, stems: 0, last: "" };
    cur.stems += stems;
    cur.last = cur.last > day ? cur.last : day;
    people.set(key, cur);
  }
  const list = Array.from(people.entries()).sort((a, b) => b[1].stems - a[1].stems);
  let sent = 0;
  for (const [key, p] of list) {
    const skip = staff.has(key) ? "сотрудник" : optOut.has(key) ? "отписался" : talking.has(key) ? "уже пишет нам сегодня" : "";
    const text = personalize(spec.text, greetingName("", p.name), false);
    console.log(`\n${p.name} …${key.slice(-4)} · брал ${p.stems} шт., последняя ${p.last}${skip ? ` · ПРОПУСК: ${skip}` : ""}`);
    if (skip) continue;
    console.log(text);
    if (!send || sent >= max) continue;
    if (sent > 0) await new Promise((r) => setTimeout(r, 40_000 + Math.floor(Math.random() * 40_000)));
    const id = await sendBotMessage(p.phone, text);
    console.log(id ? `→ отправлено (${id.slice(0, 8)}…)` : "→ НЕ отправлено (нет Green API)");
    if (id) sent++;
  }
  console.log(`\nКандидатов: ${list.length}. ${send ? `Отправлено: ${sent}.` : "Только показ. Отправить: --send"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
