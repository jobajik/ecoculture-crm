import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Заявку завели дважды (двойное нажатие) — убрать лишнюю, не потеряв ни отгрузку, ни счёт (27.11.2026, №DFW6D и
 * №9084U: Бауржан оформил Гульнаре одну и ту же заявку два раза с разницей в десять секунд; склад отгрузил 100 шт. по
 * ОДНОЙ, а счёт Kaspi бухгалтер выставила по ДРУГОЙ. Менеджер: «DFW6D надо удалить» — но на ней отгрузка, а
 * `delete-orders` заявку с отгрузкой не удаляет никогда).
 *
 * Что делает: отгрузки удаляемой заявки переезжают на остающуюся (строки журнала отгрузок, «отгружено» у позиций,
 * статус, день и склад — как было по факту; накладные клиенту — тоже), потом удаляемая заявка стирается. Остатки
 * партий не меняются: цветок ушёл один раз, и один раз остаётся записан. Всё одной атомарной записью, перед ней —
 * копия таблицы; без --yes только показ.
 *
 * Отказывает, если это не близнецы (разный клиент или состав), если у удаляемой есть деньги, счёт Kaspi (живой или
 * оплаченный) или рекламация, если отгружены обе (тогда цветок правда ушёл дважды — это не дубль).
 *
 *   npx tsx scripts/merge-duplicate-order.ts <json> [--yes] [--no-backup]
 *   json: { "remove": "DFW6D", "keep": "9084U", "note": "кто просил и почему" }
 */
import { readFileSync } from "node:fs";
import { commitAtomic, forgetReads, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { toIsoDate } from "../src/lib/sheetDate";
import { createBackup } from "../src/lib/backup";
import { logMoney } from "../src/lib/repo/moneyLog";
import { describeDeletedOrder } from "../src/lib/orderDelete";
import { isOpenKaspiStatus } from "../src/lib/kaspiInvoice";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
type Row = { rec: Record<string, string>; rowNumber: number };

async function rows(tab: string): Promise<Row[]> {
  const t = await readTable(tab, { fresh: true });
  return t.rows.map((r, i) => ({ rec: rowToRecord(tab, r), rowNumber: t.rowNumbers[i] }));
}

const itemKey = (i: Row) => [i.rec.FlowerType, i.rec.Variety, i.rec.Grade, sheetNumber(i.rec.Quantity), sheetNumber(i.rec.UnitPrice)].join("|");

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { remove: string; keep: string; note?: string };
  forgetReads();
  const [orders, items, shipments, payments, invoices, claims, waybills] = await Promise.all([
    rows(SHEET_TABS.ORDERS),
    rows(SHEET_TABS.ORDER_ITEMS),
    rows(SHEET_TABS.SHIPMENTS),
    rows(SHEET_TABS.PAYMENTS),
    rows(SHEET_TABS.KASPI_INVOICES),
    rows(SHEET_TABS.CLAIMS),
    rows(SHEET_TABS.WAYBILLS).catch(() => [] as Row[]),
  ]);
  const find = (code: string) => {
    const c = code.trim().toUpperCase();
    const found = orders.filter((o) => o.rec.OrderID === c || o.rec.OrderID.endsWith(`-${c}`));
    if (found.length !== 1) throw new Error(`Заявка «${c}»: найдено ${found.length}`);
    return found[0];
  };
  const gone = find(spec.remove);
  const keep = find(spec.keep);
  if (gone.rec.OrderID === keep.rec.OrderID) throw new Error("Это одна и та же заявка");
  const of = (o: Row) => items.filter((i) => i.rec.OrderID === o.rec.OrderID);
  const goneItems = of(gone);
  const keepItems = of(keep);
  const show = (label: string, o: Row, its: Row[]) => {
    console.log(`${label}: ${o.rec.OrderID} · ${o.rec.ClientName} · создана ${o.rec.CreatedAt} · доставка ${toIsoDate(o.rec.DeliveryDate)} · статус ${o.rec.Status} · склад ${o.rec.Store || "основной"} · оплачено ${sheetNumber(o.rec.PaidAmount)}`);
    for (const i of its) console.log(`   ${i.rec.ItemID}: ${i.rec.FlowerType} ${i.rec.Variety} ${i.rec.Grade} — ${i.rec.Quantity} шт. × ${i.rec.UnitPrice} · отгружено ${sheetNumber(i.rec.ShippedQuantity)}`);
  };
  show("Удаляем", gone, goneItems);
  show("Остаётся", keep, keepItems);

  if ((gone.rec.ClientID || gone.rec.ClientName) !== (keep.rec.ClientID || keep.rec.ClientName)) throw new Error("Клиенты разные — это не дубль");
  if (gone.rec.Status === ORDER_STATUSES.CANCELLED || keep.rec.Status === ORDER_STATUSES.CANCELLED) throw new Error("Одна из заявок отменена");
  // Близнецы: позиции совпадают одна к одной (цветок, сорт, категория, количество, цена).
  const pool = [...keepItems];
  const pair = new Map<string, Row>();
  for (const g of goneItems) {
    const at = pool.findIndex((k) => itemKey(k) === itemKey(g));
    if (at < 0) throw new Error(`Состав разный: позиции «${g.rec.Variety} ${g.rec.Grade} — ${g.rec.Quantity} шт.» в остающейся заявке нет`);
    pair.set(g.rec.ItemID, pool.splice(at, 1)[0]);
  }
  if (pool.length) throw new Error("Состав разный: в остающейся заявке есть позиции, которых нет в удаляемой");
  if (sheetNumber(gone.rec.PaidAmount) > 0 || payments.some((p) => p.rec.OrderID === gone.rec.OrderID)) throw new Error("По удаляемой заявке есть деньги — так её не удаляют");
  const goneInvoices = invoices.filter((k) => k.rec.OrderID === gone.rec.OrderID && (isOpenKaspiStatus(k.rec.Status) || k.rec.Status === "paid"));
  if (goneInvoices.length) throw new Error(`По удаляемой заявке есть счёт Kaspi (№${goneInvoices.map((k) => k.rec.InvoiceID).join(", ")}) — сначала его отменяет бухгалтер`);
  if (claims.some((c) => c.rec.OrderID === gone.rec.OrderID)) throw new Error("По удаляемой заявке есть рекламация");
  const goneShipped = goneItems.reduce((s, i) => s + sheetNumber(i.rec.ShippedQuantity), 0);
  const keepShipped = keepItems.reduce((s, i) => s + sheetNumber(i.rec.ShippedQuantity), 0);
  if (goneShipped > 0 && keepShipped > 0) throw new Error("Отгружены ОБЕ заявки — цветок ушёл дважды, это не дубль");

  const moved = shipments.filter((s) => s.rec.OrderID === gone.rec.OrderID);
  const journal = moved.reduce((s, r) => s + sheetNumber(r.rec.Quantity), 0);
  if (Math.abs(journal - goneShipped) > 0.001) throw new Error(`Журнал отгрузок (${journal}) не сходится с «отгружено» (${goneShipped}) — сначала разобраться`);
  const bills = waybills.filter((w) => w.rec.OrderID === gone.rec.OrderID);
  const liveInvoices = invoices.filter((k) => k.rec.OrderID === keep.rec.OrderID && isOpenKaspiStatus(k.rec.Status));
  console.log(`Переезжает на остающуюся: строк отгрузки ${moved.length} (${goneShipped} шт.), накладных клиенту ${bills.length}`);
  console.log(`Счёт Kaspi у остающейся: ${liveInvoices.map((k) => `№${k.rec.InvoiceID} на ${k.rec.Amount} (${k.rec.Status})`).join(", ") || "нет живого"}`);

  const stamp = `перенесено с дубля ${gone.rec.OrderID}`;
  const ops: WriteOp[] = [];
  const header: Record<string, unknown> = {};
  if (goneShipped > 0) {
    for (const s of moved) {
      const to = pair.get(s.rec.ItemID);
      if (!to) throw new Error(`Строка отгрузки ${s.rec.ShipmentID} ссылается на незнакомую позицию`);
      ops.push({ kind: "update", tab: SHEET_TABS.SHIPMENTS, rowNumber: s.rowNumber, changes: { OrderID: keep.rec.OrderID, ItemID: to.rec.ItemID, Notes: [s.rec.Notes, stamp].filter(Boolean).join(" · ") } });
    }
    for (const g of goneItems) {
      const to = pair.get(g.rec.ItemID)!;
      ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: to.rowNumber, changes: { ShippedQuantity: sheetNumber(g.rec.ShippedQuantity) } });
    }
    for (const w of bills) ops.push({ kind: "update", tab: SHEET_TABS.WAYBILLS, rowNumber: w.rowNumber, changes: { OrderID: keep.rec.OrderID, Note: [w.rec.Note, stamp].filter(Boolean).join(" · ") } });
    // Как было по факту: день, склад и статус — от заявки, по которой цветок ушёл.
    header.Status = gone.rec.Status;
    header.DeliveryDate = toIsoDate(gone.rec.DeliveryDate);
    if ((gone.rec.Store || "") !== (keep.rec.Store || "")) header.Store = gone.rec.Store || "";
  }
  const note = `Дубль ${gone.rec.OrderID} удалён ${new Date().toISOString().slice(0, 10)}${goneShipped > 0 ? `, отгрузка ${goneShipped} шт. перенесена сюда` : ""}${spec.note ? `: ${spec.note}` : ""}`;
  header.Notes = [keep.rec.Notes, note].filter(Boolean).join(" · ").slice(0, 900);
  ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: keep.rowNumber, changes: header });
  ops.push({ kind: "delete", tab: SHEET_TABS.ORDER_ITEMS, rowNumbers: goneItems.map((i) => i.rowNumber) });
  ops.push({ kind: "delete", tab: SHEET_TABS.ORDERS, rowNumbers: [gone.rowNumber] });
  console.log(`Остающаяся после правки: ${Object.entries(header).filter(([k]) => k !== "Notes").map(([k, v]) => `${k} = ${v}`).join(", ") || "шапка без изменений"}`);
  console.log(`Заметка: «${note}»`);

  if (!yes) return console.log("\nТолько показ. Записать — с --yes.");
  if (!process.argv.includes("--no-backup")) {
    const backup = await createBackup();
    console.log(`Копия таблицы: ${backup.title}`);
  }
  await commitAtomic(ops);
  const total = goneItems.reduce((s, i) => s + sheetNumber(i.rec.Quantity) * sheetNumber(i.rec.UnitPrice), 0);
  await logMoney({
    actorEmail: OWNER,
    orderId: gone.rec.OrderID,
    action: MONEY_LOG_ACTIONS.ORDER_DELETED,
    details: describeDeletedOrder({
      orderId: gone.rec.OrderID,
      clientName: gone.rec.ClientName,
      managerEmail: gone.rec.ManagerEmail,
      totalAmount: total,
      items: goneItems.map((i) => ({ variety: i.rec.Variety, grade: i.rec.Grade, quantity: sheetNumber(i.rec.Quantity) })),
      reason: `дубль заявки ${keep.rec.OrderID}${goneShipped > 0 ? `, отгрузка ${goneShipped} шт. перенесена на неё` : ""}${spec.note ? ` · ${spec.note}` : ""}`,
    }).slice(0, 900),
    amountBefore: 0,
    amountAfter: 0,
  });
  await logMoney({
    actorEmail: OWNER,
    orderId: keep.rec.OrderID,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details: note.slice(0, 900),
    amountBefore: sheetNumber(keep.rec.PaidAmount),
    amountAfter: sheetNumber(keep.rec.PaidAmount),
  });
  console.log(`Записано: ${ops.length} изменений одной записью.`);
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
