/*
 * Номер Земфиры — что готово: есть ли в CRM пользователь «Лиды с рекламы», вписаны ли ключи
 * второго инстанса Green API и подключён ли номер (QR). Ключи не печатает — только «есть / нет».
 * Запуск: npx tsx scripts/diag-zemfira-line.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getInstanceState, greenLeadsConfig } from "../src/lib/greenApi";
import { listUsers } from "../src/lib/repo/users";
import { listWaMessages } from "../src/lib/repo/talks";
import { leadsLineOwner } from "../src/lib/waAutoLead";

async function main() {
  const users = await listUsers();
  const leadgen = users.filter((u) => u.role === "leadgen");
  console.log("=== Пользователи «Лиды с рекламы» ===");
  if (!leadgen.length) console.log("нет ни одного — заведите Земфиру в «Настройках» с ролью «Лиды с рекламы»");
  for (const u of leadgen) console.log(`${u.name || "(без имени)"} · ${u.active ? "активна" : "выключена"}`);
  console.log(`Хозяйка линии для авто-лидов: ${leadsLineOwner(users) ? "есть" : "НЕТ — лиды будут ничьи"}`);

  console.log("\n=== Ключи второго номера ===");
  const cfg = greenLeadsConfig();
  console.log(cfg ? `есть (instance ${cfg.instance.length} цифр)` : "НЕТ — запустите zemfira-whatsapp-key.bat");
  if (cfg) {
    try {
      console.log(`Состояние номера: ${await getInstanceState(cfg)}`);
    } catch (e) {
      console.log(`Green API не ответил: ${e instanceof Error ? e.message : e}`);
    }
  }

  const msgs = (await listWaMessages({ lines: "all" })).filter((m) => m.line === "leads");
  console.log(`\nСообщений с номера Земфиры в CRM: ${msgs.length}${msgs.length ? `, последнее ${msgs.map((m) => m.at).sort().pop()}` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
