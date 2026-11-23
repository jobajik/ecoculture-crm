import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Накладные клиентам: через сколько после отгрузки ушла каждая и почему не сразу (23.11.2026, владелец: «почему
 * накладные клиентам в чат не приходят сразу?»). Только чтение.
 *
 * По каждой накладной автомата: последняя отгрузка, вошедшая в неё; когда проход взял её в работу; сколько прошло;
 * была ли к этой минуте отгружена вся часть заявки этого производства («сразу») или отгрузка была частичной (тогда
 * правило ждёт 20 минут тишины и следующего прохода); пришлась ли отправка на ежечасный проход расписания.
 *
 *   npx tsx scripts/diag-waybill-delay.ts [дней=4]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listWaybills } from "../src/lib/repo/waybills";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { WAYBILL_QUIET_MINUTES, waybillAuto } from "../src/lib/waybill";
import { getFarmFor } from "../src/lib/constants";
import { orderCode } from "../src/lib/paymentStage";

const almaty = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const mins = (ms: number) => Math.round(ms / 60000);

async function main() {
  const days = Math.max(1, Number(process.argv[2]) || 4);
  const from = Date.now() - days * 86400000;
  const [map, waybills, shipments, orders] = await Promise.all([settingsMap(true), listWaybills({ fresh: true }), listShipments(), listOrdersWithItems()]);
  const auto0 = waybillAuto(map);
  console.log(`Автоотправка: ${auto0.on ? "включена" : "ВЫКЛЮЧЕНА"}${auto0.since ? `, с ${auto0.since}` : ""}`);
  const shipById = new Map(shipments.map((s) => [s.shipmentId, s]));
  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const rows: { at: string; code: string; delay: number; kind: string; cron: boolean; ships: number; span: number; by: string; status: string }[] = [];
  for (const w of waybills) {
    if (Date.parse(w.createdAt) < from) continue;
    const own = w.shipmentIds.map((id) => shipById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (own.length === 0) continue;
    const times = own.map((s) => Date.parse(s.createdAt)).filter((t) => !Number.isNaN(t));
    const last = Math.max(...times);
    const first = Math.min(...times);
    const order = orderById.get(w.orderId);
    // Была ли к минуте последней отгрузки отгружена вся часть заявки тех производств, чей цветок в накладной.
    let complete = false;
    if (order) {
      const farms = new Set(own.map((s) => getFarmFor(order.items.find((i) => i.itemId === s.itemId)?.flowerType ?? "") ?? ""));
      const shippedBy = new Map<string, number>();
      for (const s of shipments) if (s.orderId === w.orderId && Date.parse(s.createdAt) <= last) shippedBy.set(s.itemId, (shippedBy.get(s.itemId) ?? 0) + s.quantity);
      complete = Array.from(farms).every((farm) => order.items.filter((i) => (getFarmFor(i.flowerType) ?? "") === farm && i.quantity > 0).every((i) => (shippedBy.get(i.itemId) ?? 0) >= i.quantity));
    }
    const created = new Date(w.createdAt);
    const minute = created.getUTCMinutes();
    rows.push({
      at: w.createdAt,
      code: `${orderCode(w.orderId)}${w.number.includes("-") ? ` (${w.number.split("-").pop()}-я)` : ""}`,
      delay: mins(Date.parse(w.createdAt) - last),
      kind: complete ? "вся часть отгружена" : "частичная",
      // Расписание будит раз в час в :00 по Гринвичу, до накладных доходит через 3–20 минут.
      cron: minute >= 2 && minute <= 22,
      ships: own.length,
      span: mins(last - first),
      by: w.byEmail === "auto" ? "автомат" : "кнопкой",
      status: w.status,
    });
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : 1));
  console.log(`\nНакладные за ${days} дн. (время — Алматы): ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${almaty(r.at)} № ${r.code.padEnd(12)} через ${String(r.delay).padStart(4)} мин после отгрузки · ${r.kind}${r.ships > 1 ? ` · отгрузок ${r.ships} за ${r.span} мин` : ""} · ${r.by}${r.cron ? " · в минуты ежечасного прохода" : ""} · ${r.status}`);
  }
  const auto = rows.filter((r) => r.by === "автомат" && r.delay >= 0);
  const group = (name: string, list: typeof auto) => {
    if (list.length === 0) return console.log(`  ${name}: нет`);
    const d = list.map((r) => r.delay).sort((a, b) => a - b);
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    console.log(`  ${name}: ${list.length} · до 2 мин: ${list.filter((r) => r.delay <= 2).length} · 3–${WAYBILL_QUIET_MINUTES + 5} мин: ${list.filter((r) => r.delay > 2 && r.delay <= WAYBILL_QUIET_MINUTES + 5).length} · дольше: ${list.filter((r) => r.delay > WAYBILL_QUIET_MINUTES + 5).length} · половина — до ${q(0.5)} мин, самая долгая — ${d[d.length - 1]} мин · в минуты ежечасного прохода: ${list.filter((r) => r.cron).length}`);
  };
  console.log("\nИтог по автомату:");
  group("вся часть заявки отгружена (должна уходить сразу)", auto.filter((r) => r.kind === "вся часть отгружена"));
  group("частичная отгрузка (правило ждёт 20 мин тишины)", auto.filter((r) => r.kind === "частичная"));
  // По часам суток (Алматы): когда отгружают и когда уходит.
  const hours = new Map<number, number>();
  for (const s of shipments) if (Date.parse(s.createdAt) >= from) { const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(new Date(s.createdAt))) % 24; hours.set(h, (hours.get(h) ?? 0) + 1); }
  console.log(`\nОтгрузки по часам (Алматы): ${Array.from(hours.entries()).sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}ч:${n}`).join(" ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
