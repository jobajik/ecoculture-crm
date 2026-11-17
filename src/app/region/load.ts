import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isRegionStore, normalizeStore, regionStoreInfo, type StoreCode } from "@/lib/officeStore";
import { REGION_ACCEPT_FROM, buildTruckOrders, regionAccess, regionHome, regionSeat, retailCardsOf, type TruckOrderView } from "@/lib/regionTruck";
import { regionTabsFor } from "@/lib/regionTabs";
import { managerProfiles } from "@/lib/repo/regionStore";
import { listRegionReceipts, prefetchRegion } from "@/lib/repo/regionTruck";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listShipments } from "@/lib/repo/shipments";
import { listStockMoves } from "@/lib/repo/stockMoves";
import { listUsers } from "@/lib/repo/users";
import { addDaysToKey } from "@/lib/dayKey";
import { localDayKey } from "@/lib/timezone";
import { almatyHourOf } from "@/lib/officeStore";
import { nextTruckDay } from "@/lib/regionTruck";

/**
 * Общая загрузка страниц города (`/region/<код>`): кто открыл, что ему можно, кто сидит в городе и когда фура.
 * Незнакомый код города — «не найдено»; чужой город — `access.view` ложно, страница отвечает словами.
 */
export async function loadRegion(storeParam: string) {
  const session = await getServerSession(authOptions);
  const store = normalizeStore(storeParam);
  const info = regionStoreInfo(store);
  if (!isRegionStore(store) || !info || store !== storeParam) notFound();
  const role = session?.user?.role ?? "";
  const actor = { role, store: session?.user?.store, director: session?.user?.director };
  const access = regionAccess(actor, store);
  const home = regionHome(actor);
  await prefetchRegion();
  const [profiles, users] = await Promise.all([managerProfiles().catch(() => ({})), listUsers().catch(() => [])]);
  const seat = regionSeat(profiles, store);
  const nameOf = (email: string) => users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || email;
  const today = localDayKey();
  return {
    session,
    role,
    email: session?.user?.email?.toLowerCase() ?? "",
    store: store as StoreCode,
    info: info!,
    access,
    home,
    seat,
    nameOf,
    today,
    truckDay: nextTruckDay(today, seat.truckWeekday, almatyHourOf(new Date())),
    /** Вкладки — в шапку страницы только тому, у кого раздел города свой (у остальных — полоса `RegionNav`). */
    tabs: regionTabsFor(store, access),
    headerTabs: home.all ? undefined : regionTabsFor(store, access),
  };
}

/** Заказы на фуру города за последние недели — для страниц «Остатки» и «Фура». */
export async function loadTruckOrders(store: StoreCode, today: string): Promise<{ orders: TruckOrderView[]; retailCard: { clientId: string; name: string } | null }> {
  const [orders, clients, shipments, moves, receipts] = await Promise.all([listOrdersWithItems(), listClients(), listShipments(), listStockMoves(), listRegionReceipts()]);
  const cards = retailCardsOf(clients, store);
  const active = cards.find((c) => c.active) ?? null;
  const from = addDaysToKey(today, -28) < REGION_ACCEPT_FROM ? addDaysToKey(REGION_ACCEPT_FROM, -14) : addDaysToKey(today, -28);
  return {
    orders: buildTruckOrders({ store, orders, retailCardIds: new Set(cards.map((c) => c.clientId)), shipments, moves, receipts, from }),
    retailCard: active ? { clientId: active.clientId, name: active.name } : null,
  };
}
