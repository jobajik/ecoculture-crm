import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Накладные клиентам — что ушло и что ждёт (19.11.2026). Только чтение.
 * Печатает: включена ли автоотправка, последние накладные (кому — последние 4 цифры, с какого номера, чем кончилось) и
 * заявки с отгрузками, которые ещё не вошли в накладные, — с ответом правила «что сейчас сделал бы автомат».
 *
 *   npx tsx scripts/diag-waybills.ts [дней=3]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listWaybills } from "../src/lib/repo/waybills";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { planWaybill, uncoveredShipments, waybillAuto, waybillOrderRefusal } from "../src/lib/waybill";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const days = Math.max(1, Number(process.argv[2]) || 3);
  const from = Date.now() - days * 86400000;
  const [map, waybills, shipments, orders] = await Promise.all([settingsMap(true), listWaybills({ fresh: true }), listShipments(), listOrdersWithItems()]);
  const auto = waybillAuto(map);
  console.log(`Автоотправка: ${auto.on ? "включена" : "ВЫКЛЮЧЕНА"}${auto.since ? `, с ${auto.since}` : ""}`);
  const recent = waybills.filter((w) => Date.parse(w.createdAt) >= from).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const count = (s: string) => recent.filter((w) => w.status === s).length;
  console.log(`\nНакладных за ${days} дн.: ${recent.length} — отправлено ${count("sent")}, не отправлено ${count("failed")}, не отправлялось ${count("skipped")}, в работе ${count("sending")}, повторов ${count("duplicate")}`);
  for (const w of recent) {
    console.log(
      `  ${w.createdAt.slice(0, 16).replace("T", " ")}Z № ${w.number} · ${w.stems} шт. · ${w.amount} ₸ · ${w.status}` +
        `${w.phone ? ` · …${w.phone.slice(-4)}` : ""}${w.line ? ` · линия ${w.line.startsWith("m-") ? "менеджера" : w.line}` : ""}${w.note ? ` · ${w.note}` : ""} · ${w.byEmail === "auto" ? "автомат" : "кнопкой"}`
    );
  }
  const now = new Date();
  const byOrder = new Map<string, typeof shipments>();
  for (const s of shipments) if (Date.parse(s.createdAt) >= from) byOrder.set(s.orderId, [...(byOrder.get(s.orderId) ?? []), s]);
  console.log(`\nОтгрузки за ${days} дн. без накладной:`);
  let shown = 0;
  for (const [orderId, own] of byOrder) {
    const order = orders.find((o) => o.orderId === orderId);
    if (!order || waybillOrderRefusal(order)) continue;
    const mine = waybills.filter((w) => w.orderId === orderId);
    const left = uncoveredShipments(own, mine);
    if (left.length === 0) continue;
    const plan = auto.on ? planWaybill({ order, shipments: own, waybills: mine, mode: "auto", since: auto.since, now }) : null;
    const verdict = !auto.on ? "автомат выключен" : !plan ? "автомат не возьмёт (до включения или старше двух суток)" : "wait" in plan ? `ждёт: ${plan.wait}` : `пора отправлять (${plan.why})`;
    console.log(`  № ${orderCode(orderId)} · ${order.clientName} · ${left.reduce((s, x) => s + x.quantity, 0)} шт. · последняя отгрузка ${left.map((x) => x.createdAt).sort().pop()?.slice(0, 16).replace("T", " ")}Z · ${verdict}`);
    shown += 1;
  }
  if (shown === 0) console.log("  нет");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
