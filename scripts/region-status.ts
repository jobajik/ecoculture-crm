import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Регионы сейчас — то же, что видит владелец на странице «Регионы», текстом (17.11.2026). Только чтение.
 * По каждому городу: кто посажен, день фуры, остаток склада города, заказы на фуру с 02.11 — что ждёт загрузки, что в
 * пути и ждёт приёмки, что принято и с какой недостачей.
 *
 *   npx tsx scripts/region-status.ts
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { listBatches } from "../src/lib/repo/batches";
import { listClients } from "../src/lib/repo/clients";
import { listShipments } from "../src/lib/repo/shipments";
import { listStockMoves } from "../src/lib/repo/stockMoves";
import { listRegionReceipts } from "../src/lib/repo/regionTruck";
import { managerProfiles } from "../src/lib/repo/regionStore";
import { REGION_STORES, inStore } from "../src/lib/officeStore";
import { TRUCK_STAGE_LABELS, WEEKDAY_FULL, buildTruckOrders, regionSeat, retailCardsOf } from "../src/lib/regionTruck";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const [orders, users, batches, clients, shipments, moves, receipts, profiles] = await Promise.all([
    listOrdersWithItems(),
    listUsers(),
    listBatches(),
    listClients(),
    listShipments(),
    listStockMoves(),
    listRegionReceipts(),
    managerProfiles(true),
  ]);
  const nameOf = (email: string) => users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || "(нет сотрудника)";
  console.log(`Записей приёмки: ${receipts.length}`);
  for (const info of REGION_STORES) {
    const seat = regionSeat(profiles, info.code);
    const stock = inStore(batches, info.code).reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);
    const cards = retailCardsOf(clients, info.code);
    const truck = buildTruckOrders({ store: info.code, orders, retailCardIds: new Set(cards.map((c) => c.clientId)), shipments, moves, receipts, from: "2026-11-02" });
    console.log(
      `\n== ${info.label}: директор ${seat.directors.map(nameOf).join(", ") || "не назначен"}; менеджер города ${seat.managers.map(nameOf).join(", ") || "нет"}; фура — ${WEEKDAY_FULL[seat.truckWeekday]}; ` +
        `на складе города ${stock} шт.; карточка розницы: ${cards.map((c) => c.name).join(", ") || "нет"}`
    );
    const transit = truck.filter((o) => o.stage === "transit");
    console.log(`   в пути — ждёт приёмки: ${transit.reduce((s, o) => s + o.pending, 0)} шт. в ${transit.length} заказах`);
    for (const o of truck) {
      console.log(
        `   ${o.deliveryDate} № ${orderCode(o.orderId)} ${o.kind === "wholesale" ? "опт" : "магазины"} · ${TRUCK_STAGE_LABELS[o.stage]} · заказано ${o.ordered}, отгружено ${o.shipped}, ждёт ${o.pending}` +
          `${o.accepted || o.shortage ? `, принято ${o.accepted}, недостача ${o.shortage}` : ""} · ${nameOf(o.managerEmail)}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
