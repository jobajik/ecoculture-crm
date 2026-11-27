import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Перевести НЕОТГРУЖЕННУЮ заявку с хризантемой на другую компанию (27.11.2026, №PIJKM: бот оформил «хризантему
 * Rose Farm Altaj, Четвёртая», а цветок — Есентая; из чата «CRM»: «Нужно поменять заявку на Есентай Агро Хим»).
 * Компания следует из цветка: `chrysanthemum` — Есентай, `chrysanthemum_rf` — Rose Farm. Меняется цветок позиций
 * (сорт, категория, количество и цена — как были), оплаченное переносится в ячейку новой компании, у строк журнала
 * платежей меняется цветок. Счета Kaspi НЕ трогаются: куда деньги пришли на самом деле, остаётся в строке счёта, а в
 * заметке заявки и в журнале денег пишется «оплата пришла на Kaspi другой компании — взаиморасчёт между ТОО».
 * Отгруженную позицию так не переводят (`ship-item-as`, `fix-shipment-batch`). Всё — одной атомарной записью.
 *
 *   npx tsx scripts/order-to-farm.ts <json> [--yes] [--no-backup]
 *   json: { "order": "PIJKM", "farm": "esentai" | "rose_farm", "note": "кто просил и почему" }
 */
import { readFileSync } from "node:fs";
import { commitAtomic, forgetReads, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { toIsoDate } from "../src/lib/sheetDate";
import { createBackup } from "../src/lib/backup";
import { logMoney } from "../src/lib/repo/moneyLog";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { FARMS, FARM_LABELS, FLOWER_TYPE_LABELS, MONEY_LOG_ACTIONS, getFarmFor, isChrysanthemum } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const FLOWER_OF_FARM: Record<string, string> = { [FARMS.ESENTAI]: "chrysanthemum", [FARMS.ROSE_FARM]: "chrysanthemum_rf" };
const FIELD: Record<string, string> = { [FARMS.ESENTAI]: "PaidEsentai", [FARMS.ROSE_FARM]: "PaidRoseFarm" };
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function rows(tab: string) {
  const t = await readTable(tab, { fresh: true });
  return t.rows.map((r, i) => ({ rec: rowToRecord(tab, r), rowNumber: t.rowNumbers[i] }));
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { order: string; farm: string; note?: string };
  const target = (spec.farm || "").trim();
  const newFlower = FLOWER_OF_FARM[target];
  if (!newFlower) throw new Error("farm: esentai или rose_farm");
  forgetReads();
  const [orders, items, payments, invoices, batches] = await Promise.all([rows(SHEET_TABS.ORDERS), rows(SHEET_TABS.ORDER_ITEMS), rows(SHEET_TABS.PAYMENTS), rows(SHEET_TABS.KASPI_INVOICES), rows(SHEET_TABS.BATCHES)]);
  const code = spec.order.trim().toUpperCase();
  const found = orders.filter((o) => o.rec.OrderID === code || o.rec.OrderID.endsWith(`-${code}`));
  if (found.length !== 1) throw new Error(`Заявка «${code}»: найдено ${found.length}`);
  const order = found[0];
  if (order.rec.Status === "cancelled") throw new Error("Заявка отменена");
  const mine = items.filter((i) => i.rec.OrderID === order.rec.OrderID);
  const store = (order.rec.Store || "").trim();
  console.log(`Заявка ${order.rec.OrderID} · статус ${order.rec.Status} · склад ${store || "основной"} · доставка ${toIsoDate(order.rec.DeliveryDate)} · оплачено ${money(sheetNumber(order.rec.PaidAmount))} (Rose Farm ${money(sheetNumber(order.rec.PaidRoseFarm))}, Есентай ${money(sheetNumber(order.rec.PaidEsentai))})`);

  const move = mine.filter((i) => getFarmFor(i.rec.FlowerType as never) !== target);
  if (!move.length) throw new Error(`Все позиции уже у компании «${FARM_LABELS[target] ?? target}»`);
  const prices = await getCurrentPrices();
  let moved = 0;
  for (const i of move) {
    if (!isChrysanthemum(i.rec.FlowerType)) throw new Error(`Позиция ${i.rec.ItemID}: ${FLOWER_TYPE_LABELS[i.rec.FlowerType] ?? i.rec.FlowerType} есть только у своей компании — перевести нельзя`);
    if (sheetNumber(i.rec.ShippedQuantity) > 0) throw new Error(`Позиция ${i.rec.ItemID} уже отгружается (${i.rec.ShippedQuantity} шт.) — такую переводят через ship-item-as / fix-shipment-batch`);
    const qty = sheetNumber(i.rec.Quantity);
    const price = sheetNumber(i.rec.UnitPrice);
    moved += qty * price;
    const byStore = (flower: string) =>
      batches
        .filter((b) => b.rec.FlowerType === flower && b.rec.Variety === i.rec.Variety && b.rec.Grade === i.rec.Grade)
        .reduce((m, b) => m.set(b.rec.Store || "основной", (m.get(b.rec.Store || "основной") ?? 0) + sheetNumber(b.rec.QuantityRemaining)), new Map<string, number>());
    const now = byStore(newFlower);
    const was = byStore(i.rec.FlowerType);
    const free = now.get(store || "основной") ?? 0;
    const list = (m: Map<string, number>) => Array.from(m.entries()).map(([k, v]) => `${k} ${v}`).join(", ") || "нет партий";
    console.log(`  ${i.rec.ItemID}: ${FLOWER_TYPE_LABELS[i.rec.FlowerType]} → ${FLOWER_TYPE_LABELS[newFlower]} · ${i.rec.Variety} · ${i.rec.Grade} · ${qty} шт. × ${price} ₸ (прайс новой компании: ${priceFor(prices, newFlower, i.rec.Variety, i.rec.Grade)} ₸)`);
    console.log(`     на складе «${store || "основной"}» у новой компании: ${free} шт.${free < qty ? " — МЕНЬШЕ, чем в заявке" : ""}; у новой по складам: ${list(now)}; у прежней по складам: ${list(was)}`);
  }

  // Оплаченное: если после перевода компания одна — всё в её ячейку; иначе переносим не больше суммы переведённых позиций.
  const farmsAfter = new Set(mine.map((i) => (move.includes(i) ? target : getFarmFor(i.rec.FlowerType as never))));
  const paid = { [FARMS.ROSE_FARM]: sheetNumber(order.rec.PaidRoseFarm), [FARMS.ESENTAI]: sheetNumber(order.rec.PaidEsentai) } as Record<string, number>;
  const from = target === FARMS.ESENTAI ? FARMS.ROSE_FARM : FARMS.ESENTAI;
  const shift = farmsAfter.size === 1 ? paid[from] : Math.min(paid[from], moved);
  const header: Record<string, unknown> = {};
  if (farmsAfter.size === 1) {
    header[FIELD[target]] = sheetNumber(order.rec.PaidAmount);
    header[FIELD[from]] = 0;
  } else if (shift > 0) {
    header[FIELD[target]] = paid[target] + shift;
    header[FIELD[from]] = paid[from] - shift;
  }
  const oldFlowers = new Set(move.map((i) => i.rec.FlowerType));
  const payRows = payments.filter((p) => p.rec.OrderID === order.rec.OrderID && (oldFlowers.has(p.rec.Flower) || p.rec.Farm === from));
  const paidInvoices = invoices.filter((k) => k.rec.OrderID === order.rec.OrderID && k.rec.Farm === from);
  const open = paidInvoices.filter((k) => ["pending", "processing", "created"].includes(k.rec.Status));
  if (open.length) throw new Error(`По заявке есть неоплаченный счёт Kaspi компании «${FARM_LABELS[from]}» (№${open.map((k) => k.rec.InvoiceID).join(", ")}) — сначала его отменяет бухгалтер`);
  const landed = paidInvoices.filter((k) => k.rec.Status === "paid").reduce((s, k) => s + sheetNumber(k.rec.Amount), 0);
  const settle = landed > 0 ? `оплата ${money(landed)} пришла на Kaspi «${FARM_LABELS[from]}» (счёт №${paidInvoices.filter((k) => k.rec.Status === "paid").map((k) => k.rec.InvoiceID).join(", ")}) — взаиморасчёт между ТОО` : "";
  const note = `Переведена на «${FARM_LABELS[target]}» ${new Date().toISOString().slice(0, 10)}${spec.note ? `: ${spec.note}` : ""}${settle ? `; ${settle}` : ""}`;
  console.log(`Оплаченное: ${Object.entries(header).map(([k, v]) => `${k} = ${v}`).join(", ") || "без изменений"}; строк журнала платежей с новым цветком: ${payRows.length}`);
  console.log(`Заметка заявки: «${note}»`);

  const ops: WriteOp[] = [
    ...move.map((i): WriteOp => ({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: i.rowNumber, changes: { FlowerType: newFlower } })),
    { kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: order.rowNumber, changes: { ...header, Notes: [order.rec.Notes, note].filter(Boolean).join(" · ").slice(0, 900) } },
    ...payRows.map((p): WriteOp => ({ kind: "update", tab: SHEET_TABS.PAYMENTS, rowNumber: p.rowNumber, changes: { ...(oldFlowers.has(p.rec.Flower) ? { Flower: newFlower } : {}), ...(p.rec.Farm === from ? { Farm: target } : {}) } })),
  ];
  if (!yes) return console.log("\nТолько показ. Записать — с --yes.");
  if (!process.argv.includes("--no-backup")) {
    const backup = await createBackup();
    console.log(`Копия таблицы: ${backup.title}`);
  }
  await commitAtomic(ops);
  await logMoney({
    actorEmail: OWNER,
    orderId: order.rec.OrderID,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details: `Заявка переведена: «${FARM_LABELS[from]}» → «${FARM_LABELS[target]}» (${move.length} поз., ${money(moved)})${settle ? `; ${settle}` : ""}${spec.note ? ` · ${spec.note}` : ""}`.slice(0, 900),
    amountBefore: sheetNumber(order.rec.PaidAmount),
    amountAfter: sheetNumber(order.rec.PaidAmount),
  });
  console.log(`Записано: ${ops.length} изменений одной записью.`);
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
