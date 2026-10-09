import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Ответить заново на последнее сообщение клиента, если бот ответил плохо
 * (02.10.2026: «третью категорию, одна коробка» → бот спросил «50 или 100?»).
 * Модель видит переписку без нашего неудачного ответа; уходит новый ответ.
 * Без --send — только показ.
 *
 *   npx tsx scripts/bot-redo.ts 3627600 [--at <слово>] [--prompt] [--send]
 *
 * `--at` — ответить на последнее сообщение клиента, где есть это слово (латиницей или цифрами — из .bat
 * русские слова портятся), а не на самое последнее.
 */
import { commitAtomic } from "../src/lib/sheets";
import { botChatWrite, listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { botSettingsFrom, pushContext } from "../src/lib/broadcast";
import { botAct, botPrompt, botReply, noteForManager, sendBotFiles } from "../src/lib/botEngine";
import { greenConfig, sendText } from "../src/lib/greenApi";

async function main() {
  const suffix = process.argv.slice(2).find((a) => /^\d{4,}$/.test(a)) ?? "";
  const send = process.argv.includes("--send");
  const [chats, map] = await Promise.all([listBotChats(true), settingsMap(true)]);
  const found = chats.find((c) => c.phone.replace(/\D/g, "").endsWith(suffix));
  if (!suffix || !found) throw new Error("чат не найден");
  const ai = process.argv.indexOf("--at");
  const word = ai >= 0 ? String(process.argv[ai + 1] || "").toLowerCase() : "";
  const lastClient = word
    ? found.context.map((m) => m.role === "client" && m.text.toLowerCase().includes(word)).lastIndexOf(true)
    : found.context.map((m) => m.role).lastIndexOf("client");
  if (lastClient < 0) throw new Error("клиент ещё не писал");
  const trimmed = { ...found, context: found.context.slice(0, lastClient + 1) };
  if (process.argv.includes("--prompt")) {
    const p = await botPrompt(trimmed, botSettingsFrom(map).instructions);
    console.log(`--- подсказка: ${p.system.length} знаков ---\n${p.system}\n--- переписка ---\n${p.user}\n---`);
  }
  const d = await botReply(trimmed, botSettingsFrom(map).instructions);
  console.log(`клиент: ${found.context[lastClient].text}`);
  console.log(`модель: ${d.reply}${d.order.confirmed ? "  [ЗАКАЗ]" : ""}${d.catalog ? `  [каталог ${d.catalog}]` : ""}${d.photo.flowerType ? `  [фото: ${[d.photo.flowerType, d.photo.variety, d.photo.grade].filter(Boolean).join(" ")}]` : ""}`);
  if (!send) return console.log("Только показ.");
  // После неудачного ответа должно быть ровно одно наше сообщение: клиент уже написал снова — бот ответил сам.
  if (found.context.length - 1 !== lastClient + 1) return console.log("После нашего ответа уже была переписка — не отправляю.");
  // Подтверждённый заказ без «да» клиента здесь не оформляем.
  if (d.order.confirmed) throw new Error("модель решила оформить заказ — без «да» клиента не отправляю");
  const chat = { ...found, context: [...found.context], ourIds: [...found.ourIds] };
  const { text, note, files } = await botAct(chat, d);
  await sendBotFiles(chat, chat.phone, files);
  if (text) {
    const id = await sendText(greenConfig()!, chat.phone, text);
    chat.ourIds = [...chat.ourIds, id].slice(-20);
    chat.context = pushContext(chat.context, { role: "us", text, at: new Date().toISOString() });
  }
  chat.botReplies += 1;
  noteForManager(chat, note);
  await commitAtomic([botChatWrite(chat, found.rowNumber)]);
  console.log(`отправлено: ${text}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
