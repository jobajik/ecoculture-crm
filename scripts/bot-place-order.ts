import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Оформить заказ бота вручную, когда клиент уже согласился, а бот переспросил
 * (02.10.2026, владелец: «просто выставь счёт и оформляй»). Тот же путь, что у
 * бота: карточка, заявка на склад, счёт Kaspi, подтверждение клиенту. Без
 * --send — только проверка заказа по складу и прайсу.
 *

 *   npx tsx scripts/bot-place-order.ts args.json [--send]   (тот же список в файле)
 *   npx tsx scripts/bot-place-order.ts 3627600 "chrysanthemum|Altaj|Третья|200" 2026-10-03 "Мерке" "Рауда" "примечание" [--send]
 */
import { commitAtomic } from "../src/lib/sheets";
import { botChatWrite, listBotChats } from "../src/lib/repo/broadcasts";
import { pushContext } from "../src/lib/broadcast";
import { placeBotOrder } from "../src/lib/botOrderRunner";
import { noteForManager } from "../src/lib/botEngine";
import { planBotOrder } from "../src/lib/botOrder";
import { stockMap } from "../src/lib/botKnowledge";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { localDayKey } from "../src/lib/timezone";
import { greenConfig, sendText } from "../src/lib/greenApi";

async function main() {
  let args = process.argv.slice(2).filter((a) => a !== "--send");
  // Русские слова из .bat портятся кодировкой консоли — можно передать файлом JSON (UTF-8) со списком аргументов.
  if (args[0]?.endsWith(".json")) args = JSON.parse((await import("node:fs")).readFileSync(args[0], "utf8"));
  const send = process.argv.includes("--send");
  const [suffix, itemsArg, date, city, shop, note] = args;
  const items = String(itemsArg || "")
    .split(";")
    .filter(Boolean)
    .map((s) => {
      const [flowerType, variety, grade, qty] = s.split("|");
      return { flowerType, variety, grade, quantity: Number(qty) };
    });
  const draft = { confirmed: true, items, deliveryDate: date || "", city: city || "", shopName: shop || "", address: "", note: note || "" };
  const chats = await listBotChats(true);
  const found = chats.find((c) => c.phone.replace(/\D/g, "").endsWith(suffix || "-"));
  if (!found) throw new Error(`чат не найден (чатов прочитано: ${chats.length}, номер …${suffix})`);
  const now = new Date();
  const [batches, settings, prices] = await Promise.all([listBatches(), getSettings(), getCurrentPrices(localDayKey(now))]);
  const plan = planBotOrder({ draft, stock: Array.from(stockMap(batches, settings, now).values()), priceOf: (f, v, g) => priceFor(prices, f, v, g), today: localDayKey(now) });
  console.log(plan.ok ? `заказ: ${JSON.stringify(plan.items)} на ${plan.deliveryDate}` : `не оформится: ${plan.question}`);
  if (!send || !plan.ok) return console.log(send ? "Не отправлено." : "Только проверка.");
  const placed = await placeBotOrder({ phone: found.phone, senderName: found.name, draft, kaspiPhone: "" });
  console.log(`заявка ${placed.orderId || "НЕ создана"} · ${placed.note}`);
  const id = await sendText(greenConfig()!, found.phone, placed.text);
  const chat = { ...found, context: [...found.context], ourIds: [...found.ourIds, id].slice(-20) };
  chat.context = pushContext(chat.context, { role: "us", text: placed.text, at: new Date().toISOString() });
  chat.botReplies += 1;
  noteForManager(chat, placed.note);
  await commitAtomic([botChatWrite(chat, found.rowNumber)]);
  console.log(`клиенту: ${placed.text.replace(/\s+/g, " ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
