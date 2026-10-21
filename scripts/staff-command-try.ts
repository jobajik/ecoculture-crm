import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что бот сделает с поручением сотрудника (`staffCommandRunner.ts`) — без отправки: разбор, кому, с какого номера, какие фото.
 * Текст поручения — из файла (русские слова в .bat портятся кодировкой консоли).
 *
 *   npx tsx scripts/staff-command-try.ts <файл с текстом> <номер сотрудника>
 */
import { readFileSync } from "node:fs";
import { dryRunStaffCommand } from "../src/lib/staffCommandRunner";

async function main() {
  const [file, phone] = process.argv.slice(2);
  if (!file || !phone) throw new Error("нужны файл с текстом и номер сотрудника");
  const text = readFileSync(file, "utf8").replace(/^﻿/, "").trim();
  console.log(`Поручение: ${text}`);
  for (const line of await dryRunStaffCommand(text, phone)) console.log(line);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
