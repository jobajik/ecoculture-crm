import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { REGION_STORES, almatyHourOf, inStore } from "@/lib/officeStore";
import {
  REGION_ACCEPT_FROM,
  WEEKDAY_FULL,
  buildTruckOrders,
  cityClientOrders,
  nextTruckDay,
  regionAccess,
  regionHome,
  regionSeat,
  retailCardsOf,
} from "@/lib/regionTruck";
import { shipDayLabel } from "@/lib/managerProfile";
import { managerProfiles } from "@/lib/repo/regionStore";
import { listRegionReceipts, prefetchRegion } from "@/lib/repo/regionTruck";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listShipments } from "@/lib/repo/shipments";
import { listStockMoves } from "@/lib/repo/stockMoves";
import { listBatches } from "@/lib/repo/batches";
import { listUsers } from "@/lib/repo/users";
import { orderPayState } from "@/lib/orderPay";
import { ORDER_STATUSES } from "@/lib/constants";
import { addDaysToKey } from "@/lib/dayKey";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/**
 * «Регионы» — все города одной страницей (17.11.2026): кто директор, когда фура, сколько лежит в городе, что едет и ждёт
 * приёмки, сколько должны клиенты. Для владельца, РОПа и зав. складом; директора города страница уводит в его город.
 */
export default async function RegionsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const actor = { role, store: session?.user?.store, director: session?.user?.director };
  const home = regionHome(actor);
  if (!home.all && home.own) redirect(`/region/${home.own}`);
  if (!home.all) {
    return (
      <div>
        <PageHeader area="stock" title="Регионы" icon="store" />
        <p className="card text-sm text-ink-secondary">Раздел города ведёт директор региона — у вас города нет. Назначает администратор в «Настройках».</p>
      </div>
    );
  }
  await prefetchRegion();
  const [profiles, users, orders, clients, shipments, moves, receipts, batches] = await Promise.all([
    managerProfiles().catch(() => ({})),
    listUsers().catch(() => []),
    listOrdersWithItems(),
    listClients(),
    listShipments(),
    listStockMoves(),
    listRegionReceipts(),
    listBatches(),
  ]);
  const today = localDayKey();
  const hour = almatyHourOf(new Date());
  const nameOf = (email: string) => users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name || email;
  const cityOf = new Map(clients.map((c) => [c.clientId, c.city]));
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const from = addDaysToKey(REGION_ACCEPT_FROM, -1);

  const cities = REGION_STORES.map((info) => {
    const access = regionAccess(actor, info.code);
    const seat = regionSeat(profiles, info.code);
    const stock = inStore(batches, info.code).reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);
    const truck = buildTruckOrders({ store: info.code, orders, retailCardIds: new Set(retailCardsOf(clients, info.code).map((c) => c.clientId)), shipments, moves, receipts, from });
    const transit = truck.filter((o) => o.stage === "transit").reduce((s, o) => s + o.pending, 0);
    const waiting = truck.filter((o) => o.stage === "waiting" || o.stage === "loading");
    const shortage = truck.reduce((s, o) => s + o.shortage, 0);
    const debts = access.money
      ? cityClientOrders(orders, info.code, (id) => cityOf.get(id))
          .filter((o) => o.status !== ORDER_STATUSES.CANCELLED)
          .map((o) => orderPayState(o, today))
      : [];
    return {
      info,
      access,
      seat,
      stock,
      transit,
      waitingStems: waiting.reduce((s, o) => s + (o.ordered - o.shipped), 0),
      waitingOrders: waiting.length,
      shortage,
      debt: debts.reduce((s, p) => s + p.debt, 0),
      late: debts.filter((p) => p.late).reduce((s, p) => s + p.debt, 0),
      truckDay: nextTruckDay(today, seat.truckWeekday, hour),
    };
  });

  return (
    <div>
      <PageHeader area="stock" title="Регионы" subtitle="Склады городов, фуры и директора" icon="store" />
      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-4">
        {cities.map((c) => (
          <div key={c.info.code} className="card !p-0 overflow-hidden">
            <div className="flex items-start gap-3 px-4 sm:px-5 py-3 border-b border-line-hairline">
              <div className="min-w-0 mr-auto">
                <Link href={`/region/${c.info.code}`} className="font-semibold text-[15px] hover:text-accent">
                  {c.info.label}
                </Link>
                <div className="text-xs text-ink-muted mt-0.5">
                  фура — {WEEKDAY_FULL[c.seat.truckWeekday]}, ближайшая {shipDayLabel(c.truckDay).split(", ")[1]}
                </div>
              </div>
              {c.transit > 0 ? <Pill tone="wait">ждёт приёмки</Pill> : c.seat.directors.length === 0 ? <Pill tone="muted">без директора</Pill> : null}
            </div>
            <div className="px-4 sm:px-5 py-3 text-sm space-y-1.5">
              <Row label="Директор">
                {c.seat.directors.length > 0 ? (
                  c.seat.directors.map(nameOf).join(", ")
                ) : role === "admin" ? (
                  <Link href="/admin?tab=regions" className="text-accent hover:underline">
                    назначить в «Настройках»
                  </Link>
                ) : (
                  <span className="text-ink-muted">не назначен</span>
                )}
                {c.seat.managers.length > 0 && <span className="text-ink-muted"> · менеджер города: {c.seat.managers.map(nameOf).join(", ")}</span>}
              </Row>
              <Row label="На складе города">{nf(c.stock)} шт.</Row>
              <Row label="В пути — ждёт приёмки">{c.transit > 0 ? <b className="font-semibold text-[#8a5a00]">{nf(c.transit)} шт.</b> : "нет"}</Row>
              <Row label="Заказано на фуру">{c.waitingOrders > 0 ? `${nf(c.waitingStems)} шт. · заказов: ${c.waitingOrders}` : "заказов нет"}</Row>
              {c.shortage > 0 && (
                <Row label="Недостача при приёмке">
                  <span className="text-status-critical">{nf(c.shortage)} шт.</span>
                </Row>
              )}
              {c.access.money && (
                <Row label="Долг клиентов города">
                  {c.debt > 0 ? (
                    <>
                      {nf(c.debt)} ₸{c.late > 0 && <span className="text-status-critical"> · просрочено {nf(c.late)} ₸</span>}
                    </>
                  ) : (
                    "нет"
                  )}
                </Row>
              )}
            </div>
            <div className="flex flex-wrap gap-2 px-4 sm:px-5 py-3 border-t border-line-hairline">
              <Link href={`/region/${c.info.code}`} className="btn-secondary !py-1.5 text-sm">
                Остатки
              </Link>
              <Link href={`/region/${c.info.code}/truck`} className={c.transit > 0 && c.access.accept ? "btn-primary !py-1.5 text-sm" : "btn-secondary !py-1.5 text-sm"}>
                Фура
              </Link>
              {c.access.money && (
                <Link href={`/region/${c.info.code}/money`} className="btn-secondary !py-1.5 text-sm">
                  Оплаты и долги
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3">
      <span className="text-ink-secondary">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
