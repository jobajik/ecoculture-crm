import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что в базе по просьбе склада «сорт записан не тот — поменяйте» (12.11.2026: «№6JOZ0 эустома Alissa White Стандарт 70
 * поменять на Alissa 1 Pure White; 7.11 склад офис — 140 так же; 12.11 Руслану Алтай Высший 100 на замену — списать?»).
 * Ничего не меняет. Печатает: заявку с позициями и отгрузками; партии сорта (все склады) с движением; перемещения
 * в офис за дни; свежие заявки и перемещения по второму сорту.
 *
 *   npx tsx scripts/diag-swap-request.ts <номер заявки> <цветок> <слово сорта> <с ГГГГ-ММ-ДД> [цветок2 слово2 градация2]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listBatches } from "../src/lib/repo/batches";
import { listStockMoves } from "../src/lib/repo/stockMoves";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listClaims } from "../src/lib/repo/claims";
import { listUsers } from "../src/lib/repo/users";
import { orderCode } from "../src/lib/paymentStage";

const d16 = (iso: string) => String(iso || "").slice(0, 16);

async function main() {
  const [code, flower, word, since, flower2, word2, gradeArg] = process.argv.slice(2);
  // Русские слова из .bat портятся кодировкой консоли — градацию можно назвать латиницей.
  const grade2 = ({ top: "Высшая", first: "Первая", second: "Вторая", third: "Третья" } as Record<string, string>)[gradeArg] ?? gradeArg;
  if (!code) throw new Error("Нужен номер заявки (дальше: цветок, слово сорта, дата «с»; «-» вместо цветка — только заявка)");
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.SHIPMENTS, SHEET_TABS.BATCHES, SHEET_TABS.STOCK_MOVES, SHEET_TABS.WRITEOFFS, SHEET_TABS.USERS, SHEET_TABS.CLAIMS]);
  const [orders, shipments, batches, moves, writeoffs, users, claims] = await Promise.all([listOrdersWithItems(), listShipments(), listBatches(), listStockMoves(), listWriteoffs(), listUsers(), listClaims()]);
  const who = (e: string) => users.find((u) => u.email.toLowerCase() === String(e || "").toLowerCase())?.name || e || "—";
  const batchOf = new Map(batches.map((b) => [b.batchId, b]));
  const bl = (id: string) => {
    const b = batchOf.get(id);
    return b ? `${id} [${b.variety} · ${b.grade} · срезка ${b.harvestDate} · ${b.store || "основной"}]` : `${id} [партии нет]`;
  };
  const has = (v: string, w: string) => v.toLowerCase().includes(w.toLowerCase());

  console.log(`=== Заявка ${code} ===`);
  for (const o of orders.filter((x) => orderCode(x.orderId) === code.toUpperCase())) {
    console.log(`${o.orderId} · создана ${d16(o.createdAt)} · ${who(o.managerEmail)} · клиент «${o.clientName}» · статус ${o.status} · склад ${o.store || "основной"} · доставка ${o.deliveryDate} · сумма ${o.totalAmount} · оплачено ${o.paidAmount}`);
    for (const i of o.items) {
      console.log(`  позиция ${i.itemId}: ${i.flowerType} · ${i.variety} · ${i.grade} · заказано ${i.quantity} · отгружено ${i.shippedQuantity} · цена ${i.unitPrice}`);
      for (const s of shipments.filter((x) => x.itemId === i.itemId)) console.log(`    отгрузка ${s.shipmentId} · ${d16(s.createdAt)} · ${s.quantity} шт. · ${who(s.warehouseEmail)} · партия ${bl(s.batchId)}${s.notes ? ` · ${s.notes}` : ""}`);
      // Та же позиция на других складах — на случай «отгрузили из офиса, а записали с основного».
      for (const b of batches.filter((x) => x.flowerType === i.flowerType && x.variety === i.variety && x.grade === i.grade && x.store && x.quantityRemaining > 0)) {
        console.log(`    есть на складе «${b.store}»: ${b.batchId} · срезка ${b.harvestDate} · остаток ${b.quantityRemaining}`);
      }
    }
    for (const c of claims.filter((x) => x.orderId === o.orderId)) console.log(`  рекламация ${c.claimId} · ${d16(c.createdAt)} · ${c.status} · ${c.reason} · ${c.comment}`);
  }

  const show = (fl: string, w: string, gr?: string) => {
    console.log(`\n=== Партии: ${fl} · «${w}»${gr ? ` · ${gr}` : ""} (приняты с ${since} или с остатком) ===`);
    const list = batches
      .filter((b) => b.flowerType === fl && has(b.variety, w) && (!gr || b.grade === gr) && (b.quantityRemaining > 0 || String(b.receivedAt).slice(0, 10) >= since))
      .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
    for (const b of list) {
      console.log(`${b.batchId} · ${b.variety} · ${b.grade} · принята ${d16(b.receivedAt)} (${who(b.receivedByEmail)}) · срезка ${b.harvestDate} · приход ${b.quantityIn} · остаток ${b.quantityRemaining} · ${b.store || "основной"}${b.sourceBatchId ? ` · из ${b.sourceBatchId}` : ""}`);
      for (const s of shipments.filter((x) => x.batchId === b.batchId)) {
        const o = orders.find((x) => x.orderId === s.orderId);
        console.log(`    − отгрузка ${s.quantity} · ${d16(s.createdAt)} · заявка ${orderCode(s.orderId)} «${o?.clientName ?? "?"}» · ${who(s.warehouseEmail)}`);
      }
      for (const m of moves.filter((x) => x.fromBatchId === b.batchId || x.toBatchId === b.batchId)) console.log(`    ${m.fromBatchId === b.batchId ? "−" : "+"} перемещение ${m.direction} ${m.quantity} · ${d16(m.createdAt)} · ${who(m.byEmail)} · ${m.moveId} · ${m.fromBatchId} → ${m.toBatchId}${m.note ? ` · ${m.note}` : ""}`);
      for (const w of writeoffs.filter((x) => x.batchId === b.batchId)) console.log(`    − списание ${w.quantity} · ${d16(w.createdAt)} · ${w.reason}`);
    }
    if (list.length === 0) console.log("нет");
    console.log(`--- перемещения ${fl} «${w}» с ${since} ---`);
    for (const m of moves.filter((x) => x.flowerType === fl && has(x.variety, w) && (!gr || x.grade === gr) && String(x.createdAt).slice(0, 10) >= since)) console.log(`${m.moveId} · ${d16(m.createdAt)} · ${m.direction} · ${m.variety} · ${m.grade} · ${m.quantity} · ${who(m.byEmail)} · ${m.fromBatchId} → ${m.toBatchId}${m.note ? ` · ${m.note}` : ""}`);
  };
  if (flower && flower !== "-" && word && since) show(flower, word);

  if (flower2 && word2) {
    for (const fl of flower2.split(",")) {
      show(fl, word2, grade2);
      console.log(`--- заявки с ${since}: ${fl} «${word2}»${grade2 ? ` · ${grade2}` : ""} ---`);
      for (const o of orders.filter((x) => String(x.createdAt).slice(0, 10) >= since)) {
        for (const i of o.items.filter((x) => x.flowerType === fl && has(x.variety, word2) && (!grade2 || x.grade === grade2))) {
          console.log(`${orderCode(o.orderId)} · ${d16(o.createdAt)} · ${who(o.managerEmail)} · «${o.clientName}» · ${o.status} · склад ${o.store || "основной"} · ${o.kind || "клиент"}${o.retail ? ` · розница ${o.retail}` : ""} · ${i.variety} ${i.grade} × ${i.quantity} (отгружено ${i.shippedQuantity})`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
