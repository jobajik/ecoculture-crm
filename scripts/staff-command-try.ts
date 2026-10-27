import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что бот сделает с поручением сотрудника (`staffCommandRunner.ts`) — без отправки: разбор, кому, с какого номера, какие фото.
 * Текст поручения — из файла (русские слова в .bat портятся кодировкой консоли).
 *
 *   npx tsx scripts/staff-command-try.ts <файл с текстом> <номер сотрудника | почта сотрудника>
 */
import { readFileSync } from "node:fs";
import { dryRunStaffCommand } from "../src/lib/staffCommandRunner";
import { listUsers } from "../src/lib/repo/users";
import { listWaLines } from "../src/lib/repo/waLines";

async function main() {
  const [file, phone] = process.argv.slice(2);
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
  for (const line of await dryRunStaffCommand(text, staffPhone)) console.log(line);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
