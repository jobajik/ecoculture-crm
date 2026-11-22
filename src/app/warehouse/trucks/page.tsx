import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import TruckLoadBoard, { type LoadGroup, type StockPosition } from "@/components/TruckLoadBoard";
import { WAREHOUSE_TABS } from "../tabs";
import { FLOWER_TYPE_LABELS, compareGrades, farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
import { REGION_STORES, inStore } from "@/lib/officeStore";
import { buildTruckOrders, canLoadTrucks, retailCardsOf } from "@/lib/regionTruck";
import { mainStockMap, stockKey } from "@/lib/truckLoad";
import { shipDayLabel } from "@/lib/managerProfile";
import { listRegionReceipts, prefetchRegion } from "@/lib/repo/regionTruck";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listShipments } from "@/lib/repo/shipments";
import { listStockMoves } from "@/lib/repo/stockMoves";
import { listBatches } from "@/lib/repo/batches";
import { listUsers } from "@/lib/repo/users";
import { orderCode } from "@/lib/paymentStage";
import { addDaysToKey } from "@/lib/dayKey";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/**
 * «Фуры в регионы» — рабочий экран зав. складом (22.11.2026, владелец: «с производства перемещение делали зав. склады…
 * им было легко работать с формой, если каких-то позиций нет»). Все заказы городов на ближайшие фуры: что просили, что
 * есть на складе, что гружу. Зав. складом видит и грузит только цветок своего производства; администратор — весь.
 * Правила — `truckLoad.ts`, запись — `commitTruckLoad`.
 */
export default async function WarehouseTrucksPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;
  const header = <PageHeader area="stock" title="Фуры в регионы" subtitle={farm ? `Производство: ${farmLabel(farm)}` : "Заказы городов и отгрузка на склады городов"} icon="truck" tabs={WAREHOUSE_TABS} />;
  if (!canLoadTrucks(role) || (role === "warehouse" && !farm)) {
    return (
      <div>
        {header}
        <p className="card text-sm text-ink-secondary">Фуры в регионы грузит зав. складом. {role === "warehouse" ? "У вас не указано производство — попросите администратора заполнить его в «Настройках»." : ""}</p>
      </div>
    );
  }

  await prefetchRegion();
  const [orders, clients, shipments, moves, receipts, batches, users] = await Promise.all([
    listOrdersWithItems(),
    listClients(),
    listShipments(),
    listStockMoves(),
    listRegionReceipts(),
    listBatches(),
    listUsers().catch(() => []),
  ]);
  const today = localDayKey();
  const from = addDaysToKey(today, -10);
  const own = (flowerType: string) => !farm || getFarmFor(flowerType) === farm;
  const nameOf = (email: string) => (users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || "").split(/\s+/)[0] || "";
  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  const groups: LoadGroup[] = [];
  let transitStems = 0;
  const transitCities: string[] = [];
  for (const info of REGION_STORES) {
    const views = buildTruckOrders({ store: info.code, orders, retailCardIds: new Set(retailCardsOf(clients, info.code).map((c) => c.clientId)), shipments, moves, receipts, from });
    const pending = views.filter((v) => v.stage === "transit").reduce((s, v) => s + v.items.filter((i) => own(i.flowerType)).reduce((x, i) => x + i.pending, 0), 0);
    if (pending > 0) {
      transitStems += pending;
      transitCities.push(info.label);
    }
    const byDay = new Map<string, typeof views>();
    for (const v of views) {
      // Всё, по чему склад ещё должен ответить: и «в пути» тоже — когда одно производство свою часть уже погрузило,
      // заказ города становится «в пути», а позиции второго производства ещё ждут (поймано на проверочной копии).
      if (v.stage === "cancelled" || v.stage === "refused") continue;
      byDay.set(v.deliveryDate, [...(byDay.get(v.deliveryDate) ?? []), v]);
    }
    for (const [day, list] of byDay) {
      // Сначала опт (склад города), потом магазины; внутри — как заказывали.
      const sorted = [...list].sort((a, b) => (a.kind === b.kind ? (a.createdAt < b.createdAt ? -1 : 1) : a.kind === "wholesale" ? -1 : 1));
      const open = sorted.flatMap((v) => v.items.filter((i) => i.quantity - i.shipped > 0).map((i) => ({ v, i })));
      const rows = open
        .filter(({ i }) => own(i.flowerType))
        .map(({ v, i }) => ({
          itemId: i.itemId,
          orderId: v.orderId,
          code: orderCode(v.orderId),
          shop: v.kind === "retail",
          flower: FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType,
          name: `${i.variety} · ${formatGrade(i.grade)}`,
          key: stockKey(i.flowerType, i.variety, i.grade),
          asked: i.asked || i.quantity,
          shipped: i.shipped,
          left: i.quantity - i.shipped,
        }));
      if (rows.length === 0) continue;
      const who = Array.from(new Set(sorted.map((v) => nameOf(v.managerEmail)).filter(Boolean)));
      const comments = Array.from(
        new Set(
          sorted
            .map((v) => (orderById.get(v.orderId)?.notes || "").replace(/^Заказ на фуру от региона [^.]+\.\s*/, "").trim())
            .filter(Boolean)
        )
      );
      groups.push({
        key: `${info.code}:${day}`,
        store: info.code,
        city: info.label,
        day,
        dayLabel: shipDayLabel(day),
        late: day < today,
        byLine: `${who.length ? `заказал: ${who.join(", ")} · ` : ""}${sorted.length === 1 ? "заказ" : "заказы"} № ${sorted.map((v) => orderCode(v.orderId)).join(", ")}`,
        comments,
        rows,
        otherFarm: open.length - rows.length,
      });
    }
  }
  groups.sort((a, b) => (a.day === b.day ? REGION_STORES.findIndex((r) => r.code === a.store) - REGION_STORES.findIndex((r) => r.code === b.store) : a.day < b.day ? -1 : 1));

  const main = inStore(batches, "");
  const stock = mainStockMap(main, farm);
  const seen = new Map<string, StockPosition>();
  for (const b of main) {
    if (!(b.quantityRemaining > 0) || !own(b.flowerType)) continue;
    const key = stockKey(b.flowerType, b.variety, b.grade);
    if (!seen.has(key)) seen.set(key, { key, flowerType: b.flowerType, flower: FLOWER_TYPE_LABELS[b.flowerType] ?? b.flowerType, variety: b.variety.trim(), grade: b.grade.trim(), gradeLabel: formatGrade(b.grade), qty: stock[key] ?? 0 });
  }
  const ORDER = ["rose", "chrysanthemum", "chrysanthemum_rf", "eustoma"];
  const positions = Array.from(seen.values()).sort(
    (a, b) => ORDER.indexOf(a.flowerType) - ORDER.indexOf(b.flowerType) || a.variety.localeCompare(b.variety, "ru") || compareGrades(a.flowerType, a.grade, b.grade)
  );

  // Чего не хватит на всё, что просят города: по позиции — просят больше, чем лежит.
  const wanted = new Map<string, number>();
  for (const g of groups) for (const r of g.rows) wanted.set(r.key, (wanted.get(r.key) ?? 0) + r.left);
  let shortStems = 0;
  for (const [key, want] of wanted) shortStems += Math.max(0, want - (stock[key] ?? 0));
  const askedStems = groups.reduce((s, g) => s + g.rows.reduce((x, r) => x + r.left, 0), 0);
  const nextDay = groups.find((g) => !g.late)?.day ?? groups[0]?.day ?? "";

  return (
    <div>
      {header}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="list" label="Просят города" value={nf(askedStems)} hint={groups.length > 0 ? `шт. · городов и фур: ${groups.length}` : "заказов нет"} />
        <KpiTile icon="calendar" label="Ближайшая фура" value={nextDay ? shipDayLabel(nextDay).split(", ")[1] : "—"} hint={nextDay ? shipDayLabel(nextDay).split(", ")[0] : "заказов нет"} />
        <KpiTile icon="alert" label="Не хватает на складе" value={nf(shortStems)} hint={shortStems > 0 ? "шт. — ответьте городу или замените" : "хватает на всё"} tone={shortStems > 0 ? "warn" : "good"} />
        <KpiTile
          icon="truck"
          label="В пути — ждёт приёмки"
          value={nf(transitStems)}
          hint={transitStems > 0 ? transitCities.join(", ") : "всё принято городами"}
          tone={transitStems > 0 ? "warn" : undefined}
          href="/region"
        />
      </div>

      <TruckLoadBoard groups={groups} stock={stock} positions={positions} cities={REGION_STORES.map((r) => ({ code: r.code, label: r.label }))} today={today} />

      <p className="text-xs text-ink-muted mt-5">
        Отгруженное списывается с основного склада сразу и числится «в пути», пока менеджер города не подтвердит приёмку — тогда цветок ляжет на склад города. Что лежит в городах —{" "}
        <Link href="/region" className="text-accent hover:underline">
          «Регионы»
        </Link>
        .
      </p>
    </div>
  );
}
