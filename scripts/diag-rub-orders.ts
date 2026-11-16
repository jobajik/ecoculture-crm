import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Отгрузки в РФ с рублёвыми ценами — что на самом деле лежит в таблице (16.11.2026, владелец: «не пойму, почему
 * заявку по РФ я нигде не вижу»). Только чтение. Показывает и «почти такие» заявки: городские за последние дни и
 * любые с направлением «РФ» — на случай, если отгрузку завели другой формой.
 *
 *   npx tsx scripts/diag-rub-orders.ts [дней назад = 7]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { listShipments } from "../src/lib/repo/shipments";
import { readTable } from "../src/lib/sheets";
import { SHEET_TABS } from "../src/lib/constants";
import { isRegionOrder } from "../src/lib/orderKind";
import { hasRubPrices, rubTotal, formatRub, RUB_DIRECTION } from "../src/lib/rubShipment";
import { orderCode } from "../src/lib/paymentStage";
import { visibleOrdersFor } from "../src/lib/orderVisibility";

async function main() {
  const days = Number(process.argv[2]) || 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [orders, users, shipments, itemsTab] = await Promise.all([listOrdersWithItems(), listUsers(), listShipments(), readTable(SHEET_TABS.ORDER_ITEMS)]);
  console.log(`Колонки OrderItems: ${itemsTab.headers.join(", ")}`);
  const nameOf = (email: string) => users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase())?.name || "(нет сотрудника)";
  const rub = orders.filter((o) => hasRubPrices(o));
  const near = orders.filter((o) => !hasRubPrices(o) && (o.direction === RUB_DIRECTION || isRegionOrder(o)) && (o.createdAt || "") >= since);
  console.log(`Всего заявок: ${orders.length}; с рублёвыми ценами: ${rub.length}; за ${days} дн. городских и с направлением РФ без рублей: ${near.length}`);
  const adminSees = new Set(visibleOrdersFor(orders, { role: "admin", email: "", farm: "" }).map((o) => o.orderId));
  const show = (title: string, list: typeof orders) => {
    console.log(`\n== ${title}`);
    for (const o of list.sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1))) {
      const ships = shipments.filter((s) => s.orderId === o.orderId);
      console.log(
        `№ ${orderCode(o.orderId)} | создана ${o.createdAt} | отгрузка ${o.deliveryDate} | статус ${o.status} | вид ${o.kind || "-"} | направление ${o.direction || "-"} | клиент ${o.clientName || "-"} | завёл ${nameOf(o.managerEmail)} | ${formatRub(rubTotal(o.items))} | тенге ${o.totalAmount} | поступило ${o.paidAmount} | отгрузок ${ships.length} | в списке у админа: ${adminSees.has(o.orderId) ? "да" : "НЕТ"}`
      );
      for (const i of o.items) console.log(`    ${i.flowerType} ${i.variety} ${i.grade}: ${i.quantity} шт., отгружено ${i.shippedQuantity}, ${i.priceRub ?? 0} ₽, ${i.unitPrice} ₸`);
    }
    if (list.length === 0) console.log("    нет");
  };
  show("С рублёвыми ценами", rub);
  show("Похожие без рублей", near);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
