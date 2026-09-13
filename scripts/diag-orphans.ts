/*
 * Диагностика: остались ли «осиротевшие» строки после удаления заявок.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Он читает боевую таблицу и отвечает на один вопрос:
 * есть ли строки, которые ссылаются на заявку, которой больше нет.
 *
 * Зачем это нужно. Заявка живёт не одной строкой: у неё есть позиции
 * (`OrderItems`), отгрузки (`Shipments`), рекламации (`Claims`) и записи в
 * журнале денег (`MoneyLog`). Программа, удаляя заявку, убирает и позиции — но
 * строку, стёртую в Google-таблице руками, она не сопровождает ничем. Тогда
 * позиции остаются висеть, и это не безобидно:
 *
 * - позиции без заявки нигде не читаются, но занимают место и путают глаз;
 * - ОТГРУЗКА без заявки — это уже вопрос к складу: стебли из партии вычтены, а
 *   объяснить их нечем, ни продажей, ни списанием;
 * - запись в журнале денег без заявки — след платежа, который больше ни к чему
 *   не привязан.
 *
 * Скрипт печатает, чего и сколько, и на какую сумму. Решение, что с этим
 * делать, принимает человек: удалять что-либо на живой базе без спроса нельзя.
 *
 * Запуск: npx tsx scripts/diag-orphans.ts
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readTable, rowToRecord } from "../src/lib/sheets";
import { SHEET_TABS } from "../src/lib/constants";

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

async function records(tab: string): Promise<Record<string, string>[]> {
  const table = await readTable(tab);
  return table.rows.map((row) => rowToRecord(tab, row));
}

async function main() {
  const [orders, items, shipments, claims, log] = await Promise.all([
    records(SHEET_TABS.ORDERS),
    records(SHEET_TABS.ORDER_ITEMS),
    records(SHEET_TABS.SHIPMENTS),
    records(SHEET_TABS.CLAIMS),
    records(SHEET_TABS.MONEY_LOG),
  ]);

  const alive = new Set(orders.map((o) => (o.OrderID || "").trim()).filter(Boolean));
  console.log(`Заявок в таблице: ${alive.size}`);
  console.log("");

  // --- Позиции ---------------------------------------------------------------
  const lostItems = items.filter((i) => (i.OrderID || "").trim() && !alive.has(i.OrderID.trim()));
  const lostByOrder = new Map<string, { count: number; stems: number; amount: number }>();
  for (const i of lostItems) {
    const key = i.OrderID.trim();
    const cur = lostByOrder.get(key) ?? { count: 0, stems: 0, amount: 0 };
    const qty = Number(i.Quantity) || 0;
    cur.count += 1;
    cur.stems += qty;
    cur.amount += qty * (Number(i.UnitPrice) || 0);
    lostByOrder.set(key, cur);
  }

  console.log("=== 1. Позиции без заявки ===");
  if (lostItems.length === 0) {
    console.log("Нет. Каждая позиция принадлежит существующей заявке.");
  } else {
    console.log(`Строк: ${lostItems.length}, заявок: ${lostByOrder.size}`);
    for (const [orderId, v] of [...lostByOrder].sort()) {
      console.log(`  ${orderId} — ${v.count} поз. · ${v.stems.toLocaleString("ru-RU")} шт. · ${money(v.amount)}`);
    }
    console.log("Это мусор: программа их не читает, но и не уберёт сама.");
  }
  console.log("");

  // --- Отгрузки --------------------------------------------------------------
  const lostShipments = shipments.filter(
    (s) => (s.OrderID || "").trim() && !alive.has(s.OrderID.trim())
  );
  console.log("=== 2. Отгрузки без заявки ===");
  if (lostShipments.length === 0) {
    console.log("Нет.");
  } else {
    const stems = lostShipments.reduce((sum, s) => sum + (Number(s.Quantity) || 0), 0);
    console.log(`Строк: ${lostShipments.length} · ${stems.toLocaleString("ru-RU")} шт.`);
    for (const s of lostShipments) {
      console.log(`  ${s.OrderID} · ${s.ShipmentID} · ${s.Quantity} шт. · партия ${s.BatchID} · ${s.CreatedAt}`);
    }
    console.log("ВАЖНО: стебли из партий вычтены, а объяснить их теперь нечем.");
  }
  console.log("");

  // --- Рекламации ------------------------------------------------------------
  const lostClaims = claims.filter((c) => (c.OrderID || "").trim() && !alive.has(c.OrderID.trim()));
  console.log("=== 3. Рекламации без заявки ===");
  console.log(lostClaims.length === 0 ? "Нет." : `Строк: ${lostClaims.length}`);
  for (const c of lostClaims) console.log(`  ${c.OrderID} · ${c.ClaimID} · ${c.Reason}`);
  console.log("");

  // --- Журнал денег ----------------------------------------------------------
  const lostLog = log.filter((l) => (l.OrderID || "").trim() && !alive.has(l.OrderID.trim()));
  console.log("=== 4. Записи журнала денег без заявки ===");
  if (lostLog.length === 0) {
    console.log("Нет.");
  } else {
    console.log(`Строк: ${lostLog.length}`);
    for (const l of lostLog) {
      console.log(
        `  ${l.OrderID} · ${l.Action} · было ${l.AmountBefore} стало ${l.AmountAfter} · ${l.CreatedAt} · ${l.ActorEmail}`
      );
    }
    console.log("Журнал только дописывается — эти строки трогать не надо, они и есть след.");
  }
  console.log("");

  // --- Кто и почему удалил -----------------------------------------------
  //
  // Ради этого раздела журнал и заводился: заявки больше нет, и ответить на
  // вопрос «куда она делась» может только эта строка. Печатаем её целиком —
  // с почтой того, кто нажал, и с описанием, которое записывалось в момент
  // удаления: номер, клиент, менеджер, сумма, позиции и причина.
  const deletions = log.filter((l) => (l.Action || "").trim() === "order_deleted");
  console.log("=== 5. Удаления заявок: кто, когда и почему ===");
  if (deletions.length === 0) {
    console.log("Заявок через программу не удаляли ни разу.");
  } else {
    for (const l of deletions.sort((a, b) => (a.CreatedAt || "").localeCompare(b.CreatedAt || ""))) {
      console.log(`  ${l.CreatedAt} · ${l.ActorEmail || "(без почты)"} · ${l.OrderID}`);
      console.log(`      ${l.Details || "(без описания)"}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
