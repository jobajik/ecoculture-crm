/*
 * Что ответил бы продающий помощник на номере менеджера — БЕЗ отправки, без заказа и записи. Берёт
 * переписку номера с клиентом (по последним цифрам) и, по желанию, дописывает в память выдуманное
 * сообщение клиента (--say «…»). Печатает подсказку модели (--prompt) и её решение.
 * Запуск: npx tsx scripts/line-seller-try.ts <код линии> <цифры> [--say "текст"] [--prompt]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { botPrompt, botReply } from "../src/lib/botEngine";
import { listWaMessages } from "../src/lib/repo/talks";
import { listWaLines } from "../src/lib/repo/waLines";
import { listUsers } from "../src/lib/repo/users";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { lineChannel } from "../src/lib/sellerChannel";
import { lineBotChat } from "../src/lib/lineSellerRules";

async function main() {
  const args = process.argv.slice(2);
  const [code, tail] = args;
  const sayAt = args.indexOf("--say");
  const say = sayAt >= 0 ? args[sayAt + 1] || "" : "";
  const line = (await listWaLines()).find((l) => l.code === code);
  if (!line || !tail) throw new Error("нужны код линии и цифры номера");
  const name = (await listUsers()).find((u) => u.email.toLowerCase() === line.managerEmail)?.name || line.label;
  const channel = lineChannel(line, name);
  const chat = (await listWaMessages({ lines: "all" })).filter((m) => m.line === code && m.phone.endsWith(tail));
  const phone = chat[0]?.phone || tail;
  const memory = lineBotChat(phone, chat);
  if (say) memory.context.push({ role: "client", text: say, at: new Date().toISOString() });
  const instructions = ((await settingsMap()).BotInstructions || "").trim();
  if (args.includes("--prompt")) {
    const p = await botPrompt(memory, instructions, "Ответь на последнее сообщение клиента.", channel);
    console.log(p.system, "\n\n----\n", p.user);
  }
  console.log(`Переписка …${tail}: ${chat.length} сообщ., в памяти ${memory.context.length}`);
  for (const c of memory.context.slice(-6)) console.log(`  ${c.role === "client" ? "Клиент" : "Мы"}: ${c.text.replace(/\s+/g, " ").slice(0, 120)}`);
  const d = await botReply(memory, instructions, "Ответь на последнее сообщение клиента.", channel);
  console.log("\nРешение помощника:", JSON.stringify({ reply: d.reply, order: d.order.confirmed ? d.order : "нет", photo: d.photo, catalog: d.catalog, alert: d.alert, silent: d.silent }, null, 1));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
