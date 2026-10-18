import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Как сработал автопилот рассылок: план, рассылки по дням, сколько ушло, дошло, прочитали, ответили и что ответили,
 * почему пропущены, что с цепочкой отправки. Ничего не меняет.
 *   npx tsx scripts/diag-auto-broadcast.ts [дней=3]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBroadcasts, listRecipients, listWaStatuses, settingsMap } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { deliveryByMessage } from "../src/lib/broadcast";
import { phoneKey } from "../src/lib/leads";
import { AUTO_PLAN_SETTING, CHAIN_SETTING } from "../src/lib/autoBroadcast";

async function main() {
  const days = Number(process.argv[2]) || 3;
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.WA_STATUSES, SHEET_TABS.WA_MESSAGES, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS]);
  const [map, broadcasts, recipients, statuses, messages, orders] = await Promise.all([
    settingsMap(true), listBroadcasts(true), listRecipients(true), listWaStatuses(), listWaMessages({ lines: "all" }), listOrdersWithItems(),
  ]);
  console.log("План:", map[AUTO_PLAN_SETTING] || "нет");
  console.log("Цепочка:", map[CHAIN_SETTING] || "нет");
  const delivery = deliveryByMessage(statuses);
  const autos = broadcasts.filter((b) => b.auto && b.plannedFor >= from).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const b of autos) {
    const list = recipients.filter((r) => r.broadcastId === b.broadcastId);
    const by = (s: string) => list.filter((r) => r.status === s);
    const sent = by("sent");
    let delivered = 0, read = 0;
    const replies: string[] = [];
    let ordersN = 0, ordersSum = 0;
    for (const r of sent) {
      const d = delivery.get(r.messageId)?.status;
      if (d === "delivered" || d === "read") delivered++;
      if (d === "read") read++;
      const k = phoneKey(r.phone);
      const ins = messages.filter((m) => m.direction === "in" && phoneKey(m.phone) === k && m.at > r.sentAt).sort((a, c) => a.at.localeCompare(c.at));
      if (ins.length) replies.push(`  ↩ ${r.name || "без имени"} …${k.slice(-4)}: ${ins.slice(0, 3).map((m) => (m.text || `[${m.type}]`).replace(/\s+/g, " ").slice(0, 90)).join(" | ")}`);
      const os = orders.filter((o) => o.status !== "cancelled" && phoneKey(o.clientPhone) === k && o.createdAt > r.sentAt);
      ordersN += os.length;
      ordersSum += os.reduce((s, o) => s + (o.totalAmount || 0), 0);
    }
    const sentTimes = sent.map((r) => r.sentAt).sort();
    console.log(`\n=== ${b.title} [${b.status}] линия «${b.line || "основная"}» ${b.note ? `· ${b.note}` : ""}`);
    console.log(`  всего ${list.length}: ушло ${sent.length}, ждёт ${by("queued").length}, пропущено ${by("skipped").length}, ошибок ${by("error").length}`);
    if (sentTimes.length) console.log(`  отправка: ${new Date(sentTimes[0]).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })} — ${new Date(sentTimes[sentTimes.length - 1]).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`);
    console.log(`  дошло ${delivered}, прочитали ${read}, ответили ${replies.length}, заявок после ${ordersN} на ${Math.round(ordersSum)} ₸`);
    const why = new Map<string, number>();
    for (const r of [...by("skipped"), ...by("error")]) why.set(r.error || "?", (why.get(r.error || "?") ?? 0) + 1);
    for (const [w, n] of why) console.log(`  пропуск/ошибка: ${w} — ${n}`);
    for (const x of replies) console.log(x);
  }
  if (!autos.length) console.log("\nРассылок автопилота за эти дни нет.");
}
main().catch((e) => { console.error(e); process.exit(1); });
