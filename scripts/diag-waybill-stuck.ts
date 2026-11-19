import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Накладные, застрявшие в «отправляется» или не отправленные (19.11.2026): ушло ли сообщение клиенту на самом деле.
 * Только чтение. По каждой накладной за N дней: сколько секунд прошло от отгрузки до накладной и сколько заняла
 * отправка; у застрявших и неотправленных — есть ли след в переписке (`waybillSentTrace`) и что сделал бы проход.
 *
 *   npx tsx scripts/diag-waybill-stuck.ts [дней=2]
 */
import { listWaybills } from "../src/lib/repo/waybills";
import { listWaMessages } from "../src/lib/repo/talks";
import { listShipments } from "../src/lib/repo/shipments";
import { stuckWaybillAction, waybillSentTrace } from "../src/lib/waybill";

async function main() {
  const days = Math.max(1, Number(process.argv[2]) || 2);
  const from = Date.now() - days * 86400000;
  const waybills = (await listWaybills({ fresh: true })).filter((w) => Date.parse(w.createdAt) >= from).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const t0 = Date.now();
  const messages = await listWaMessages({ lines: "all" });
  console.log(`Переписка: ${messages.length} сообщений, чтение ${Date.now() - t0} мс`);
  const shipments = await listShipments();
  const now = new Date();
  for (const w of waybills) {
    const took = w.sentAt ? Math.round((Date.parse(w.sentAt) - Date.parse(w.createdAt)) / 1000) : null;
    const lastShip = shipments.filter((s) => w.shipmentIds.includes(s.shipmentId)).map((s) => s.createdAt).sort().pop() || "";
    const sinceShip = lastShip ? Math.round((Date.parse(w.createdAt) - Date.parse(lastShip)) / 1000) : null;
    let line = `${w.createdAt.slice(5, 19).replace("T", " ")}Z № ${w.number} · ${w.status}${w.phone ? ` · …${w.phone.slice(-4)}` : ""} · строк ${w.doc?.lines.length ?? 0} · от отгрузки до накладной ${sinceShip ?? "?"} с` + (took !== null ? ` · отправка ${took} с` : "") + (w.note ? ` · ${w.note}` : "");
    if ((w.status === "sending" || w.status === "failed") && w.doc) {
      const trace = waybillSentTrace({ number: w.number, phone: w.phone, createdAt: w.createdAt, orderCode: w.doc.orderCode }, messages);
      const action = stuckWaybillAction(w, !!trace, now);
      line += `\n      след в переписке: ${trace ? `есть (${trace.at.slice(11, 19)}Z, линия ${trace.line.startsWith("m-") ? "менеджера" : trace.line})` : "нет"}; проход сделает: ${action === "sent" ? "отметит отправленной" : action === "retry" ? "отправит ещё раз" : action === "fail" ? "отметит неотправленной" : "ничего"}`;
    }
    console.log("  " + line);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
