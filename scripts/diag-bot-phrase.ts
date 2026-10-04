import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Где бот писал фразу (по памяти чатов BotChats): чат, что писал клиент перед
 * этим и что ответили мы. Ничего не меняет.
 *
 *   npx tsx scripts/diag-bot-phrase.ts <слово>
 */
import { listBotChats } from "../src/lib/repo/broadcasts";

async function main() {
  const word = (process.argv[2] || "закончил").toLowerCase();
  const chats = await listBotChats(true);
  let hits = 0;
  for (const c of chats) {
    const idx = c.context.map((m, i) => (m.role === "us" && m.text.toLowerCase().includes(word) ? i : -1)).filter((i) => i >= 0);
    for (const i of idx) {
      hits += 1;
      console.log(`\n=== …${c.phone.slice(-4)} · ${c.name || ""} · ${c.context[i].at} ===`);
      for (const m of c.context.slice(Math.max(0, i - 5), i + 2)) {
        console.log(`${m.role === "client" ? "КЛ" : "МЫ"} ${m.at.slice(5, 16)}: ${m.text.replace(/\s+/g, " ").slice(0, 300)}`);
      }
      if (c.handoffReason) console.log(`записка: ${c.handoffReason.slice(0, 200)}`);
    }
  }
  console.log(`\nНайдено: ${hits}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
