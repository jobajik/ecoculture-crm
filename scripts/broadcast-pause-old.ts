import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Поставить на паузу старые «идущие» рассылки людей (запущены больше 2 дней назад) и отменить вчерашний план
 * автопилота. 18.10.2026: сайт подхватил «Пятничную рассылку» от 02.10 и разослал 40 сообщений старым текстом.
 * Печатает текст таких рассылок и кто ответил на сообщения последних 2 дней. Без --yes — только показ.
 *   npx tsx scripts/broadcast-pause-old.ts [--yes]
 */
import { commitAtomic } from "../src/lib/sheets";
import { broadcastUpdate, listBroadcastRows, listRecipients } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { phoneKey } from "../src/lib/leads";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const apply = process.argv.includes("--yes");
  const now = Date.now();
  const today = localDayKey();
  const [rows, recipients, messages] = await Promise.all([listBroadcastRows(true), listRecipients(true), listWaMessages()]);
  const writes = [];
  for (const { broadcast: b, rowNumber } of rows) {
    if (b.status !== "sending" && !(b.auto && b.status === "draft")) continue;
    const stale = b.auto ? b.plannedFor < today : now - Date.parse(b.startedAt || b.createdAt) > 2 * 86400000;
    if (!stale) continue;
    console.log(`\n=== ${b.broadcastId} «${b.title}» запущена ${b.startedAt} → ${b.auto ? "отменить" : "на паузу"}`);
    if (!b.auto) console.log(`Текст:\n${b.text}\n`);
    const recent = recipients.filter((r) => r.broadcastId === b.broadcastId && r.status === "sent" && now - Date.parse(r.sentAt) < 2 * 86400000);
    console.log(`Ушло за 2 дня: ${recent.length}`);
    for (const r of recent) {
      const k = phoneKey(r.phone);
      const ins = messages.filter((m) => m.direction === "in" && phoneKey(m.phone) === k && m.at > r.sentAt);
      if (ins.length) console.log(`  ↩ ${r.name || "без имени"} …${k.slice(-4)}: ${ins.slice(0, 3).map((m) => (m.text || `[${m.type}]`).replace(/\s+/g, " ").slice(0, 100)).join(" | ")}`);
    }
    writes.push(
      broadcastUpdate(rowNumber, b.auto
        ? { Status: "cancelled", FinishedAt: new Date().toISOString(), Note: "План автопилота на прошлый день — не досылаем" }
        : { Status: "paused", Note: "Старая рассылка: остановлена 18.10, чтобы не уходил устаревший текст" })
    );
  }
  if (!apply) return console.log(`\nТолько показ (${writes.length}). Применить: --yes`);
  if (writes.length) await commitAtomic(writes);
  console.log(`\nГотово: ${writes.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
