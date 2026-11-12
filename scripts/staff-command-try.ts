import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что бот сделает с поручением сотрудника (`staffCommandRunner.ts`) — без отправки: разбор, кому, с какого номера, какие фото.
 * Текст поручения — из файла (русские слова в .bat портятся кодировкой консоли).
 *
 *   npx tsx scripts/staff-command-try.ts <файл с текстом> <номер сотрудника | почта сотрудника | find> [файл для поиска]
 *   find — сотрудник и время берутся из сообщения основному номеру с этим текстом (или с текстом из третьего файла).
 */
import { readFileSync } from "node:fs";
import { dryRunStaffCommand } from "../src/lib/staffCommandRunner";
import { listUsers } from "../src/lib/repo/users";
import { listWaLines } from "../src/lib/repo/waLines";
import { listWaMessages } from "../src/lib/repo/talks";
import { messageText } from "../src/lib/whatsapp";

async function main() {
  const [file, phone, like] = process.argv.slice(2);
  if (!file || !phone) throw new Error("нужны файл с текстом и номер сотрудника");
  const text = readFileSync(file, "utf8").replace(/^﻿/, "").trim();
  console.log(`Поручение: ${text}`);
  // Почта вместо номера — номер берём из карточки сотрудника или его линии WhatsApp (номер в окно не печатаем).
  let staffPhone = phone;
  if (phone.includes("@")) {
    const user = (await listUsers()).find((u) => u.email.toLowerCase() === phone.toLowerCase());
    const line = (await listWaLines()).find((l) => l.managerEmail.toLowerCase() === phone.toLowerCase() && l.phone);
    staffPhone = user?.phone || line?.phone || "";
    if (!staffPhone) throw new Error("у сотрудника нет номера ни в карточке, ни у линии WhatsApp");
  }
  // «find» вместо номера — взять сотрудника и время из самого сообщения: кто последним прислал основному номеру
  // этот текст (так пробуется живой случай со снимка — с тем же пересланным перед поручением). Третий аргумент — файл
  // с текстом, по которому искать, если пробуем ДРУГОЕ поручение от того же сотрудника в тот же момент. Точного
  // совпадения нет — ищем по вхождению; тогда без третьего аргумента поручением считается само найденное сообщение.
  let source: { id: string; at: string } | undefined;
  let command = text;
  if (phone === "find") {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const needle = norm(like ? readFileSync(like, "utf8").replace(/^\uFEFF/, "") : text);
    const incoming = (await listWaMessages({ lines: "all" })).filter((m) => !m.line && m.direction === "in").sort((a, b) => (a.at < b.at ? 1 : -1));
    const exact = incoming.find((m) => norm(m.text) === needle);
    const hit = exact ?? incoming.find((m) => norm(m.text).includes(needle));
    if (!hit) throw new Error("такого сообщения основному номеру не нашёл");
    staffPhone = hit.phone;
    source = { id: like ? "" : hit.messageId, at: hit.at };
    if (!exact && !like) command = messageText(hit);
    console.log(`Сообщение найдено: ${hit.at}, с номера …${hit.phone.slice(-4)}${command !== text ? `\nПоручением считаю его целиком: ${command}` : ""}`);
  }
  for (const line of await dryRunStaffCommand(command, staffPhone, source)) console.log(line);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
