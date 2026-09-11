import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ORDER_STATUSES, RETAIL_REGION_CITIES, formatGrade } from "@/lib/constants";
import {
  buildShopDay,
  canFillRegions,
  canSeeRegions,
  cleanRegionCity,
  isRegionShop,
} from "@/lib/retail";
import { formatDay } from "@/lib/formatDate";
import SectionTabs from "@/components/SectionTabs";
import { retailTabsFor } from "../tabs";
import DayNav from "@/components/DayNav";
import CityTabs from "@/components/CityTabs";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Регионы: Астана, Семей, Усть-Каменогорск.
 *
 * Контрагент здесь — ГОРОД ЦЕЛИКОМ, а не отдельная точка: зав. складом
 * заказывает на весь город одной заявкой, а дальше развозит сама. Так решил
 * владелец, и это заметно проще, чем вести список точек в трёх городах, о
 * которых в конторе никто не знает.
 *
 * Заполняют пока сами зав. складом производства (Разия и Диана) — тоже решение
 * владельца и тоже временное. Когда в городах появятся свои люди, поменяется
 * одна функция `canFillRegions()`, а не раздел.
 *
 * Вкладка на город — не украшательство: у каждого свой день доставки и свой
 * набор, и общий список трёх городов вперемешку читался бы вдвое дольше.
 */
export default async function RetailRegionsPage({
  searchParams,
}: {
  searchParams?: { city?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeRegions(role)) redirect("/?error=forbidden");

  const city = cleanRegionCity(searchParams?.city) || RETAIL_REGION_CITIES[0];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : dayKey(tomorrow);

  const [clients, orders] = await Promise.all([listClients(), listOrdersWithItems()]);

  // Карточка города — обычная карточка розницы регионов, у которой в поле
  // «Город» стоит один из закрытого списка. Отдельной сущности не заводим:
  // это тот же контрагент, просто крупнее магазина.
  const regionCards = clients.filter((c) => isRegionShop(c) && cleanRegionCity(c.city));
  const card = regionCards.find((c) => c.city === city && c.active) ?? null;

  const { rows } = buildShopDay({
    shops: regionCards.map((c) => ({
      clientId: c.clientId,
      name: c.name,
      city: c.city,
      retail: c.retail,
      active: c.active,
    })),
    orders: orders.map((o) => ({
      orderId: o.orderId,
      clientId: o.clientId,
      deliveryDate: o.deliveryDate,
      status: o.status,
      retail: o.retail,
      managerConfirmed: o.managerConfirmed,
      items: o.items,
    })),
    date,
    territories: ["regions"],
    positionLabel: (variety, grade) => `${variety} ${formatGrade(grade)}`,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  const row = card ? rows.find((r) => r.clientId === card.clientId) ?? null : null;
  const canOrder = canFillRegions(role);

  // Свежая история города — чтобы было видно, что и когда уже отправляли.
  const history = card
    ? orders
        .filter((o) => o.clientId === card.clientId && o.status !== ORDER_STATUSES.CANCELLED)
        .sort((a, b) => (a.deliveryDate < b.deliveryDate ? 1 : -1))
        .slice(0, 10)
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">Розница — регионы</h1>
        {canOrder && card && (
          <Link
            href={`/orders/new?retail=1&client=${card.clientId}&date=${date}`}
            className="btn-primary"
          >
            + Заявка в {city}
          </Link>
        )}
      </div>
      <SectionTabs tabs={retailTabsFor(role)} />

      <div className="mt-4">
        <CityTabs cities={[...RETAIL_REGION_CITIES]} current={city} date={date} />
      </div>

      <p className="text-sm text-ink-secondary mt-4 mb-3">
        Заявка на весь город на доставку {formatDay(date)}. Оплата по ней не проводится: это
        перемещение внутри компании, и отгрузку открывает подтверждение того, кто заявку составил.
      </p>

      <DayNav date={date} today={dayKey(new Date())} basePath="/retail/regions" extra={{ city }} />

      {!card ? (
        <div className="card mt-4 text-sm text-ink-secondary">
          Карточки города «{city}» ещё нет в базе. Её заводит руководитель отдела продаж или
          администратор — до этого заявку по городу оформить нельзя.
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3 my-4">
            <Tile
              title="Заявка на день"
              value={row && !row.empty ? "оформлена" : "нет"}
              hint={row && !row.empty ? "Можно добавить добор" : "Город ждёт заявку"}
              warn={!row || row.empty}
            />
            <Tile
              title="Стеблей"
              value={row ? row.stems.toLocaleString("ru-RU") : "0"}
              hint="На этот день"
            />
            <Tile
              title="По внутренней цене"
              value={money(row?.amount ?? 0)}
              hint="Это не выручка"
            />
          </div>

          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-3 font-medium">Заявка</th>
                  <th className="px-4 py-3 font-medium">Что заказано</th>
                  <th className="px-4 py-3 font-medium text-right">Стеблей</th>
                  <th className="px-4 py-3 font-medium text-right">Сумма</th>
                  <th className="px-4 py-3 font-medium">Готовность</th>
                </tr>
              </thead>
              <tbody>
                {(row?.orders ?? []).map((o) => (
                  <tr key={o.orderId} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link href={`/orders/${o.orderId}`} className="font-medium hover:underline">
                        {o.orderId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-secondary">{o.positions || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {o.stems.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(o.amount)}</td>
                    <td className="px-4 py-2.5">
                      {o.managerConfirmed ? (
                        <span className="text-xs text-status-good">✓ подтверждена</span>
                      ) : (
                        <span className="text-xs text-[#8a5a00]">ждёт подтверждения</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(!row || row.empty) && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                      На {formatDay(date)} заявки по городу {city} нет.
                      {canOrder && (
                        <>
                          {" "}
                          <Link
                            href={`/orders/new?retail=1&client=${card.clientId}&date=${date}`}
                            className="text-accent hover:underline"
                          >
                            Оформить
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {history.length > 0 && (
            <>
              <h2 className="font-medium mt-6 mb-2">Последние отправки в {city}</h2>
              <div className="card !p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-secondary border-b border-line-hairline">
                      <th className="px-4 py-3 font-medium">Доставка</th>
                      <th className="px-4 py-3 font-medium">Заявка</th>
                      <th className="px-4 py-3 font-medium">Позиции</th>
                      <th className="px-4 py-3 font-medium text-right">Стеблей</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((o) => (
                      <tr key={o.orderId} className="border-b border-line-hairline last:border-0">
                        <td className="px-4 py-2.5 whitespace-nowrap text-ink-secondary">
                          {formatDay(o.deliveryDate)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Link href={`/orders/${o.orderId}`} className="hover:underline">
                            {o.orderId}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-ink-secondary">
                          {o.items
                            .map((i) => `${i.variety} ${formatGrade(i.grade)} — ${i.quantity}`)
                            .join(", ")}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {o.items.reduce((s, i) => s + i.quantity, 0).toLocaleString("ru-RU")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  title,
  value,
  hint,
  warn,
}: {
  title: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-sm text-ink-secondary">{title}</div>
      <div className={`text-2xl font-semibold mt-1 ${warn ? "text-[#8a5a00]" : ""}`}>{value}</div>
      <div className="text-xs text-ink-muted mt-1">{hint}</div>
    </div>
  );
}
