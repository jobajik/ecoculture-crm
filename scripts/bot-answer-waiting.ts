import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Ответить ботом в чатах, где клиент ждёт ответа, — по последним цифрам номера.
 * Владелец, 01.10.2026: «Да, отправь» (трое клиентов писали утром, бот передал
 * их менеджеру, ответа не было). Тот же ответ, что дал бы бот в вебхуке
 * (`botReply`), та же запись в BotChats. Без `--send` только показывает.
 *
 *   npx tsx scripts/bot-answer-waiting.ts 0255 8529 0523 [--send]
 */
import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { botChatWrite, listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { botSettingsFrom, botSilenceReason, pushContext } from "../src/lib/broadcast";
import { botReply, noteForManager } from "../src/lib/botEngine";
import { greenConfig, sendText } from "../src/lib/greenApi";

const mask = (phone: string) => `…${String(phone).replace(/\D/g, "").slice(-4)}`;

async function main() {
  const send = process.argv.includes("--send");
  const suffixes = process.argv.slice(2).filter((a) => /^\d{4,}$/.test(a));
  if (suffixes.length === 0) throw new Error("Укажите последние цифры номеров");
  const cfg = greenConfig();
  if (send && !cfg) throw new Error("Green API не настроен");

  await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
  const [chats, map] = await Promise.all([listBotChats(true), settingsMap()]);
  const settings = botSettingsFrom(map);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(now)) % 24;
  const writes: WriteOp[] = [];

  for (const suffix of suffixes) {
    const found = chats.filter((c) => c.phone.replace(/\D/g, "").endsWith(suffix));
    if (found.length !== 1) {
      console.log(`…${suffix}: найдено чатов ${found.length} — пропускаю`);
      continue;
    }
    const chat = { ...found[0], context: [...found[0].context], ourIds: [...found[0].ourIds] };
    const last = chat.context[chat.context.length - 1];
    if (!last || last.role !== "client") {
      console.log(`${mask(chat.phone)}: последним писали мы — пропускаю`);
      continue;
    }
    const silence = botSilenceReason({ settings, chat, messageId: `${chat.lastInMessageId}-manual`, now, hour });
    if (silence) {
      console.log(`${mask(chat.phone)}: бот сейчас молчит («${silence}») — пропускаю`);
      continue;
    }
    const d = await botReply(chat, settings.instructions);
    if (d.silent) {
      console.log(`${mask(chat.phone)}: бот решил промолчать`);
      continue;
    }
    const text = d.reply;
    console.log(`\n${mask(chat.phone)} · клиент: ${last.text.replace(/\s+/g, " ").slice(0, 120)}`);
    console.log(`   БОТ → ${text.replace(/\s+/g, " ")}${d.order ? `  [заказ: ${d.order}]` : ""}${d.alert ? `  [внимание: ${d.alert}]` : ""}`);
    if (!send) continue;
    try {
      const id = await sendText(cfg!, chat.phone, text);
      chat.ourIds = [...chat.ourIds, id].slice(-20);
      chat.context = pushContext(chat.context, { role: "us", text, at: new Date().toISOString() });
      chat.botReplies += 1;
      noteForManager(chat, d);
      writes.push(botChatWrite(chat, found[0].rowNumber));
      console.log("   отправлено");
    } catch (err) {
      console.log(`   НЕ отправлено: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (writes.length > 0) await commitAtomic(writes);
  console.log(send ? `\nОтправлено и записано: ${writes.length}` : "\nТолько показ — ничего не отправлено (добавьте --send).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
