import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Перенести живую заявку на ОТМЕНЁННУЮ (22.10.2026, владелец: «удалить сегодняшнюю заявку Айжамал и посадить её на
 * вчерашнюю отменённую заявку Сабина, но чтобы имя было Айжамал»). Отменённая заявка оживает под своим номером и
 * днём оформления, а всё остальное берёт у живой: клиента, имя, телефон, день доставки, статус, подтверждение,
 * оплату (итог и по компаниям), способ, отметки о счёте, склад. Позиции живой переезжают в неё (старые позиции
 * отменённой удаляются), платежи и счета Kaspi живой — тоже. Живая заявка удаляется. Одним атомарным запросом.
 *
 *   npx tsx scripts/order-move-to-cancelled.ts <в какую (отменённая)> <какую убрать> [--yes]
 *
 * Только если: первая отменена и ничего не отгружено, у второй ничего не отгружено и нет рекламаций.
 * Без --yes — только показ. С --yes — сначала копия всей таблицы, в конце запись в журнал денег.
 */
import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { createBackup } from "../src/lib/backup";
import { logMoney } from "../src/lib/repo/moneyLog";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const KEEP_OWN = new Set(["OrderID", "CreatedAt"]);

async function main() {
  const [keepCode, dropCode] = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());
  const yes = process.argv.includes("--yes");
  if (!keepCode || !dropCode) throw new Error("нужны два номера: <отменённая> <которую убрать>");
  const tabs = [SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.PAYMENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.SHIPMENTS, SHEET_TABS.CLAIMS];
  const t = Object.fromEntries(await Promise.all(tabs.map(async (tab) => [tab, await readTable(tab, { fresh: true })] as const)));
  const rows = (tab: string) => t[tab].rows.map((r, i) => ({ rec: rowToRecord(tab, r), rowNumber: t[tab].rowNumbers[i] }));
  const orders = rows(SHEET_TABS.ORDERS);
  const find = (code: string) => orders.find((o) => orderCode(o.rec.OrderID) === code || o.rec.OrderID.toUpperCase() === code);
  const keep = find(keepCode);
  const drop = find(dropCode);
  if (!keep) throw new Error(`заявка ${keepCode} не найдена`);
  if (!drop) throw new Error(`заявка ${dropCode} не найдена`);
  if (keep.rec.OrderID === drop.rec.OrderID) throw new Error("это одна и та же заявка");
  const keepId = keep.rec.OrderID;
  const dropId = drop.rec.OrderID;

  const items = rows(SHEET_TABS.ORDER_ITEMS);
  const keepItems = items.filter((x) => x.rec.OrderID === keepId);
  const dropItems = items.filter((x) => x.rec.OrderID === dropId);
  const ships = rows(SHEET_TABS.SHIPMENTS).filter((x) => [keepId, dropId].includes(x.rec.OrderID));
  const claims = rows(SHEET_TABS.CLAIMS).filter((x) => [keepId, dropId].includes(x.rec.OrderID));
  const pays = rows(SHEET_TABS.PAYMENTS).filter((x) => x.rec.OrderID === dropId);
  const keepPays = rows(SHEET_TABS.PAYMENTS).filter((x) => x.rec.OrderID === keepId);
  const invoices = rows(SHEET_TABS.KASPI_INVOICES).filter((x) => x.rec.OrderID === dropId);

  const show = (o: typeof keep) =>
    `№${orderCode(o.rec.OrderID)} · ${o.rec.ClientName} · оформлена ${o.rec.CreatedAt.slice(0, 10)} · доставка ${o.rec.DeliveryDate} · ${o.rec.Status} · оплачено ${o.rec.PaidAmount || 0}`;
  console.log(`Оживить: ${show(keep)}`);
  for (const x of keepItems) console.log(`   было: ${x.rec.Variety} ${x.rec.Grade} ${x.rec.Quantity} × ${x.rec.UnitPrice} (отгружено ${x.rec.ShippedQuantity || 0})`);
  console.log(`Убрать:  ${show(drop)}`);
  for (const x of dropItems) console.log(`   станет: ${x.rec.Variety} ${x.rec.Grade} ${x.rec.Quantity} × ${x.rec.UnitPrice} (отгружено ${x.rec.ShippedQuantity || 0})`);
  console.log(`Переедут: платежей ${pays.length} (${pays.map((p) => `${p.rec.Amount} ${p.rec.Date}`).join(", ") || "—"}), счетов Kaspi ${invoices.length}`);

  if (keep.rec.Status !== "cancelled") throw new Error(`№${keepCode} не отменена (${keep.rec.Status}) — переносить можно только на отменённую`);
  if (ships.length || [...keepItems, ...dropItems].some((x) => sheetNumber(x.rec.ShippedQuantity) > 0)) throw new Error("по одной из заявок есть отгрузки — так не переносим");
  if (claims.length) throw new Error("по одной из заявок есть рекламация — так не переносим");
  if (keepPays.length) throw new Error(`на №${keepCode} уже есть платежи — сначала разобраться с ними`);
  if (!dropItems.length) throw new Error(`у №${dropCode} нет позиций`);

  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(drop.rec)) if (!KEEP_OWN.has(k) && (keep.rec[k] ?? "") !== v) changes[k] = v;
  console.log(`Поля №${keepCode}: ${Object.entries(changes).map(([k, v]) => `${k}=${v === "" ? "пусто" : v}`).join(" · ")}`);
  if (!yes) return console.log("\nТолько показ. Сделать: --yes");

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url ?? JSON.stringify(backup).slice(0, 200)}`);
  const ops: Parameters<typeof commitAtomic>[0] = [];
  ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: keep.rowNumber, changes });
  dropItems.forEach((x, i) =>
    ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: x.rowNumber, changes: { OrderID: keepId, ItemID: `${keepId}-I${i + 1}` } })
  );
  for (const p of pays) ops.push({ kind: "update", tab: SHEET_TABS.PAYMENTS, rowNumber: p.rowNumber, changes: { OrderID: keepId } });
  for (const k of invoices) ops.push({ kind: "update", tab: SHEET_TABS.KASPI_INVOICES, rowNumber: k.rowNumber, changes: { OrderID: keepId } });
  if (keepItems.length) ops.push({ kind: "delete", tab: SHEET_TABS.ORDER_ITEMS, rowNumbers: keepItems.map((x) => x.rowNumber) });
  ops.push({ kind: "delete", tab: SHEET_TABS.ORDERS, rowNumbers: [drop.rowNumber] });
  await commitAtomic(ops);
  console.log("Записано.");
  await logMoney({
    actorEmail: OWNER,
    orderId: keepId,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details:
      `заявка №${dropCode} (${drop.rec.ClientName}) перенесена на отменённую №${keepCode} (${keep.rec.ClientName}) по просьбе владельца: ` +
      `клиент, доставка, оплата, позиции, платежи (${pays.length}) и счета Kaspi (${invoices.length}) — от №${dropCode}; №${dropCode} удалена`,
    amountBefore: 0,
    amountAfter: sheetNumber(drop.rec.PaidAmount),
  });
  console.log("Готово.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
