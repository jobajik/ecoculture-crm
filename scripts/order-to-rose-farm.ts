import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Хризантему заявки — с Есентая на Rose Farm (03.11.2026, Ильгар владельцу про №QTTKY: «поменять Есентай Агро Хим на
 * Роз Фарм»). Хризантема Rose Farm — отдельный товар `chrysanthemum_rf`, поэтому меняется цветок позиций, а с ним
 * склад, лист сборки и счёт по компаниям. Цены и количество не трогаются. Полученные деньги за эти позиции переходят из
 * «Есентай» в «Rose Farm» (`PaidEsentai` → `PaidRoseFarm`) и в журнале платежей (`Payments`: Farm, Flower). Счёт Kaspi —
 * факт: куда клиент заплатил, туда и пришло; скрипт его НЕ меняет, только показывает. Отгруженную хризантему не переносит.
 * Без --yes — показ; с --yes — копия таблицы и одна атомарная запись.
 *
 *   npx tsx scripts/order-to-rose-farm.ts <номер или код заявки> [--yes]
 */
import { commitAtomic, prefetchTables, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { createBackup } from "../src/lib/backup";
import { generateId } from "../src/lib/id";
import { sheetNumber } from "../src/lib/sheetCell";
import { FARM_LABELS, FLOWER_TYPES, MONEY_EPSILON, MONEY_LOG_ACTIONS, flowerPickLabel, formatGrade, getFarmFor } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const ES = FLOWER_TYPES.CHRYSANTHEMUM;
const RF = FLOWER_TYPES.CHRYSANTHEMUM_RF;
const money = (v: number) => `${Math.round(v * 100) / 100 === Math.round(v) ? Math.round(v).toLocaleString("ru-RU") : v.toFixed(2)} ₸`;
const norm = (s: string) => s.toUpperCase().replace(/I/g, "1").replace(/O/g, "0");
const r2 = (v: number) => Math.round(v * 100) / 100;

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) throw new Error("Укажите номер заявки");

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.PAYMENTS, SHEET_TABS.KASPI_INVOICES]);
  const code = norm(id.split("-").pop() || id);
  const hits = (await listOrdersWithItems()).filter((o) => o.orderId === id || norm(o.orderId).endsWith(code));
  if (hits.length !== 1) throw new Error(`Заявка «${id}» найдена ${hits.length} раз`);
  const order = hits[0];
  console.log(`${order.orderId} · ${order.clientName} · ${order.status} · сумма ${money(order.totalAmount)} · получено ${money(order.paidAmount)}`);
  console.log(`  оплата по компаниям: Rose Farm ${money(order.paidRoseFarm ?? 0)}, Есентай ${money(order.paidEsentai ?? 0)}${order.realization1c ? ` · реализация 1С: ${order.realization1c}` : ""}`);
  for (const i of order.items)
    console.log(`  ${i.itemId} · ${flowerPickLabel(i.flowerType)} ${i.variety} ${formatGrade(i.grade)} · ${i.quantity} × ${money(i.unitPrice)} · отгружено ${i.shippedQuantity}`);

  const moving = order.items.filter((i) => i.flowerType === ES);
  if (!moving.length) return console.log("\nХризантемы Есентая в заявке нет — менять нечего.");
  const shipped = moving.filter((i) => i.shippedQuantity > 0);
  if (shipped.length) throw new Error(`Хризантема уже отгружена со склада Есентая (${shipped.map((i) => i.itemId).join(", ")}) — переносить нельзя, сначала возврат.`);
  if (order.items.some((i) => getFarmFor(i.flowerType) === "esentai" && i.flowerType !== ES)) throw new Error("В заявке есть другой цветок Есентая — не понимаю, что переносить.");

  const movedAmount = r2(moving.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const paidEs = r2(order.paidEsentai ?? 0);
  const paidRf = r2(order.paidRoseFarm ?? 0);
  console.log(`\nПереношу на Rose Farm: ${moving.length} поз., ${money(movedAmount)}.`);
  console.log(`  Оплата: Есентай ${money(paidEs)} → 0, Rose Farm ${money(paidRf)} → ${money(r2(paidRf + paidEs))}`);

  const invoices = (await listKaspiInvoices({ fresh: true })).filter((k) => k.orderId === order.orderId);
  for (const k of invoices)
    console.log(`  счёт Kaspi ${k.invoiceId}: ${FARM_LABELS[k.farm] ?? k.farm} · ${money(k.amount)} · ${k.status}${k.farm === "esentai" ? " — деньги пришли на кассу Есентая, этот счёт не меняю" : ""}`);

  const [itemsT, ordersT, paysT] = await Promise.all([
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.PAYMENTS, { fresh: true }),
  ]);
  const ops: WriteOp[] = [];
  const ids = new Set(moving.map((i) => i.itemId));
  itemsT.rows.forEach((row, n) => {
    const rec = rowToRecord(SHEET_TABS.ORDER_ITEMS, row);
    if (rec.OrderID === order.orderId && ids.has(rec.ItemID) && rec.FlowerType === ES)
      ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: itemsT.rowNumbers[n], changes: { FlowerType: RF } });
  });
  if (ops.length !== moving.length) throw new Error(`Строк позиций нашлось ${ops.length}, ждал ${moving.length}`);
  const orderRow = ordersT.rows.findIndex((row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === order.orderId);
  if (orderRow < 0) throw new Error("Строка заявки не найдена");
  if (paidEs > MONEY_EPSILON)
    ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: ordersT.rowNumbers[orderRow], changes: { PaidRoseFarm: r2(paidRf + paidEs), PaidEsentai: 0 } });
  let pays = 0;
  paysT.rows.forEach((row, n) => {
    const rec = rowToRecord(SHEET_TABS.PAYMENTS, row);
    if (rec.OrderID !== order.orderId || rec.Farm !== "esentai") return;
    pays++;
    console.log(`  платёж ${rec.PaymentID} · ${rec.Date} · ${money(sheetNumber(rec.Amount))} · ${rec.Method}: Есентай → Rose Farm`);
    ops.push({
      kind: "update",
      tab: SHEET_TABS.PAYMENTS,
      rowNumber: paysT.rowNumbers[n],
      changes: { Farm: "rose_farm", ...(rec.Flower === ES || !rec.Flower ? { Flower: RF } : {}) },
    });
  });
  ops.push({
    kind: "append",
    tab: SHEET_TABS.MONEY_LOG,
    records: [
      {
        LogID: generateId("LOG"),
        CreatedAt: new Date().toISOString(),
        ActorEmail: OWNER,
        OrderID: order.orderId,
        Action: MONEY_LOG_ACTIONS.ORDER_EDITED,
        Details: `Хризантема с Есентая на Rose Farm (${moving.map((i) => `${i.variety} ${i.grade} ${i.quantity} шт.`).join("; ")}); оплата ${money(paidEs)} — на Rose Farm; платежей перенесено: ${pays}. Просьба Ильгара.`,
        AmountBefore: order.totalAmount,
        AmountAfter: order.totalAmount,
      },
    ],
  });
  if (order.realization1c) console.log("  Внимание: у заявки уже вписан номер реализации 1С — его, если нужно, поправит бухгалтер.");

  if (!yes) return console.log("\nТолько показ. Записать — с --yes (сначала копия таблицы).");
  const backup = await createBackup(new Date(), () => undefined);
  console.log(`\nКопия таблицы: ${backup.url}`);
  await commitAtomic(ops);
  const after = (await listOrdersWithItems()).find((o) => o.orderId === order.orderId);
  console.log("Записано. Теперь:");
  for (const i of after?.items ?? []) console.log(`  ${flowerPickLabel(i.flowerType)} ${i.variety} ${formatGrade(i.grade)} · ${i.quantity} × ${money(i.unitPrice)} → склад ${FARM_LABELS[getFarmFor(i.flowerType) ?? ""] ?? "?"}`);
  console.log(`  оплата: Rose Farm ${money(after?.paidRoseFarm ?? 0)}, Есентай ${money(after?.paidEsentai ?? 0)}, всего ${money(after?.paidAmount ?? 0)} из ${money(after?.totalAmount ?? 0)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
