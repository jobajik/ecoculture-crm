import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Вернуть в очередь получателей, которым рассылка поставила «ошибка» из-за лимита Google (29.10.2026: номер Земфиры,
 * «Google временно ограничил число обращений к таблице…» — сообщение не ушло не из-за человека, а рассылка его больше
 * не брала). Без --yes — только показ. С --yes: такие получатели снова «в очереди»; их рассылка, если уже «закончена» и
 * запущена не раньше чем 2 дня назад, снова «идёт» — её подхватит цепочка рассылок с обычным темпом. Старые — только
 * в списке. Телефоны — последние 4 цифры.
 *
 *   npx tsx scripts/broadcast-requeue-quota.ts [дней=3] [--yes]
 */
import { commitAtomic, isQuotaError, type WriteOp } from "../src/lib/sheets";
import { broadcastUpdate, listBroadcastRows, listRecipients, recipientUpdate } from "../src/lib/repo/broadcasts";
import { BROADCAST_STATUSES } from "../src/lib/broadcast";

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const days = Number(args.find((a) => a !== "--yes")) || 3;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [rows, recipients] = await Promise.all([listBroadcastRows(true), listRecipients(true)]);
  const hit = recipients.filter((r) => r.status === "error" && (r.sentAt || "") >= since && isQuotaError(new Error(r.error)));
  console.log(`Получателей с ошибкой «лимит Google» за ${days} дн.: ${hit.length}`);
  const writes: WriteOp[] = [];
  const recent = Date.now() - 2 * 86400000;
  for (const id of Array.from(new Set(hit.map((r) => r.broadcastId)))) {
    const b = rows.find((x) => x.broadcast.broadcastId === id);
    const mine = hit.filter((r) => r.broadcastId === id);
    const fresh = !!b && Date.parse(b.broadcast.startedAt || b.broadcast.createdAt) >= recent;
    const can = !!b && fresh && b.broadcast.status !== BROADCAST_STATUSES.CANCELLED;
    console.log(
      `\n«${b?.broadcast.title || id}» · номер «${b?.broadcast.line || "основной"}» · ${b?.broadcast.status || "?"} · ${mine.length}: ` +
        mine.map((r) => `${r.name || "без имени"} …${r.phone.slice(-4)}`).join(", ") +
        (can ? "" : " — рассылка старше 2 дней или отменена, не трогаю")
    );
    if (!can || !b) continue;
    for (const r of mine) writes.push(recipientUpdate(r.rowNumber, { Status: "queued", Error: "", SentAt: "" }));
    if (b.broadcast.status === BROADCAST_STATUSES.DONE) writes.push(broadcastUpdate(b.rowNumber, { Status: BROADCAST_STATUSES.SENDING, FinishedAt: "" }));
  }
  if (!yes) return console.log(`\nВернуть в очередь можно ${writes.length ? "— запустите с --yes" : "некого"}.`);
  if (writes.length) await commitAtomic(writes);
  console.log(`\nГотово: записей ${writes.length}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
