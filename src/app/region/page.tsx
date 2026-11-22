import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { REGION_STORES, almatyHourOf, inStore, type StoreCode } from "@/lib/officeStore";
import {
  cityStockMatrix,
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
import { FLOWER_TYPE_LABELS, ORDER_STATUSES, formatGrade } from "@/lib/constants";
import { addDaysToKey } from "@/lib/dayKey";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/**
 * «Регионы» — все города одной страницей (17.11.2026): кто менеджер города, когда фура, сколько лежит в городе, что едет
 * и ждёт приёмки, сколько должны клиенты; ниже — остатки по городам одной таблицей (22.11.2026). Для владельца, РОПа и
 * зав. складом; менеджера города страница уводит в его город.
 */
export default async function RegionsPage({ searchParams }: { searchParams?: { all?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const actor = { role, store: session?.user?.store, director: session?.user?.director };
  const home = regionHome(actor);
  if (!home.all && home.own) redirect(`/region/${home.own}`);
  if (!home.all) {
    return (
      <div>
        <PageHeader area="stock" title="Регионы" icon="store" />
        <p className="card text-sm text-ink-secondary">Раздел города ведёт менеджер города — у вас города нет. Назначает администратор в «Настройках».</p>
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

  const transitItems: { store: StoreCode; flowerType: string; variety: string; grade: string; quantity: number }[] = [];
  const cities = REGION_STORES.map((info) => {
    const access = regionAccess(actor, info.code);
    const seat = regionSeat(profiles, info.code);
    const stock = inStore(batches, info.code).reduce((s, b) => s + Math.max(0, b.quantityRemaining), 0);
    const truck = buildTruckOrders({ store: info.code, orders, retailCardIds: new Set(retailCardsOf(clients, info.code).map((c) => c.clientId)), shipments, moves, receipts, from });
    const transit = truck.filter((o) => o.stage === "transit").reduce((s, o) => s + o.pending, 0);
    // Что едет на склад города по позициям — в таблицу «Остатки по городам» (только опт: магазины на склад не ложатся).
    for (const o of truck) {
      if (o.kind !== "wholesale") continue;
      for (const i of o.items) if (i.pending > 0) transitItems.push({ store: info.code, flowerType: i.flowerType, variety: i.variety, grade: i.grade, quantity: i.pending });
    }
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

  // Остатки по городам одной таблицей (22.11.2026, владелец: «чтобы… я видел стоки их по городам»).
  const withMain = searchParams?.all === "1";
  const matrix = cityStockMatrix({ batches, transit: transitItems, withMain });
  const totals = {
    main: batches.filter((b) => !b.store && b.quantityRemaining > 0).reduce((s, b) => s + b.quantityRemaining, 0),
    cities: Object.fromEntries(cities.map((c) => [c.info.code, c.stock])) as Record<string, number>,
    transit: Object.fromEntries(cities.map((c) => [c.info.code, c.transit])) as Record<string, number>,
  };

  return (
    <div>
      <PageHeader
        area="stock"
        title="Регионы"
        subtitle="Склады городов, фуры и менеджеры"
        icon="store"
        actions={
          role === "admin" || role === "warehouse" ? (
            <Link href="/warehouse/trucks" className="btn-primary">
              Фуры в регионы
            </Link>
          ) : undefined
        }
      />
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
              {c.transit > 0 ? <Pill tone="wait">ждёт приёмки</Pill> : c.seat.directors.length + c.seat.managers.length === 0 ? <Pill tone="muted">без менеджера</Pill> : null}
            </div>
            <div className="px-4 sm:px-5 py-3 text-sm space-y-1.5">
              <Row label="Менеджер города">
                {c.seat.directors.length + c.seat.managers.length > 0 ? (
                  [...c.seat.directors, ...c.seat.managers].map(nameOf).join(", ")
                ) : role === "admin" ? (
                  <Link href="/admin?tab=regions" className="text-accent hover:underline">
                    назначить в «Настройках»
                  </Link>
                ) : (
                  <span className="text-ink-muted">не назначен</span>
                )}
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

      <div className="card !p-0 overflow-hidden mt-6" id="stock">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-3 border-b border-line-hairline">
          <h2 className="font-semibold text-[15px] mr-auto">Остатки по городам</h2>
          <Link href={withMain ? "/region#stock" : "/region?all=1#stock"} className="text-sm text-accent hover:underline">
            {withMain ? "Только то, что есть в городах" : "Показать и то, что есть только на производстве"}
          </Link>
        </div>
        {matrix.length === 0 ? (
          <p className="px-4 sm:px-5 py-5 text-sm text-ink-secondary">В городах сейчас ничего не лежит и не едет. Цветок появится здесь, когда склад отгрузит фуру, а менеджер города подтвердит приёмку.</p>
        ) : (
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="font-medium px-4 sm:px-5 py-2">Позиция</th>
                  <th className="font-medium px-3 py-2 text-right">Производство</th>
                  {REGION_STORES.map((r) => (
                    <th key={r.code} className="font-medium px-3 py-2 text-right whitespace-nowrap">
                      {r.label}
                    </th>
                  ))}
                  <th className="font-medium px-4 sm:px-5 py-2 text-right whitespace-nowrap">В городах</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, idx) => {
                  const head = idx === 0 || matrix[idx - 1].flowerType !== row.flowerType;
                  const inCities = REGION_STORES.reduce((s, r) => s + (row.cities[r.code] ?? 0), 0);
                  return (
                    <Fragment key={row.key}>
                      {head && (
                        <tr className="border-t border-line-hairline bg-surface-plane">
                          <td colSpan={REGION_STORES.length + 3} className="px-4 sm:px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                            {FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-line-hairline">
                        <td className="px-4 sm:px-5 py-2 whitespace-nowrap">
                          {row.variety} <span className="text-ink-secondary">· {formatGrade(row.grade)}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">{row.main > 0 ? nf(row.main) : "—"}</td>
                        {REGION_STORES.map((r) => {
                          const here = row.cities[r.code] ?? 0;
                          const coming = row.transit[r.code] ?? 0;
                          return (
                            <td key={r.code} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                              {here > 0 ? <span className="font-medium">{nf(here)}</span> : coming > 0 ? "" : <span className="text-ink-muted">—</span>}
                              {coming > 0 && <span className="text-xs text-[#8a5a00]">{here > 0 ? " " : ""}+{nf(coming)} в пути</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 sm:px-5 py-2 text-right tabular-nums font-medium">{inCities > 0 ? nf(inCities) : "—"}</td>
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="border-t border-line-hairline font-semibold bg-surface-plane">
                  <td className="px-4 sm:px-5 py-2">Всего, шт.</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(totals.main)}</td>
                  {REGION_STORES.map((r) => (
                    <td key={r.code} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {nf(totals.cities[r.code] ?? 0)}
                      {(totals.transit[r.code] ?? 0) > 0 && <span className="text-xs font-normal text-[#8a5a00]"> +{nf(totals.transit[r.code])} в пути</span>}
                    </td>
                  ))}
                  <td className="px-4 sm:px-5 py-2 text-right tabular-nums">{nf(Object.values(totals.cities).reduce((s, q) => s + q, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
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
