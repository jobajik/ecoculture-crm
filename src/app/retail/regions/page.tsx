import Link from "next/link";
import { canFillRegionOrders } from "@/lib/orderKind";
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
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import Pill from "@/components/Pill";
import { orderCode } from "@/lib/paymentStage";
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
      <PageHeader
        area="retail"
        title="Регионы"
        tabs={retailTabsFor(role)}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Опт на город — отдельная заявка без клиента: объём оптовикам региона.
                Рядом с розницей, потому что заполняет их один и тот же человек. */}
            {canFillRegionOrders(role) && (
              <Link href={`/orders/new?region=1&date=${date}`} className="btn-secondary">
                + Опт в регион
              </Link>
            )}
            {canOrder && card && (
              <Link
                href={`/orders/new?retail=1&client=${card.clientId}&date=${date}`}
                className="btn-primary"
              >
                + Заявка в {city}
              </Link>
            )}
          </div>
        }
      />

      {card && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <KpiTile
            icon="order"
            label={`Заявка в ${city} на ${formatDay(date)}`}
            value={row && !row.empty ? "оформлена" : "нет"}
            hint={row && !row.empty ? (row.orders.every((o) => o.managerConfirmed) ? "подтверждена" : "ждёт подтверждения") : "город ждёт заявку"}
            tone={!row || row.empty ? "bad" : row.orders.every((o) => o.managerConfirmed) ? "good" : "warn"}
          />
          <KpiTile icon="leaf" label="Стеблей" value={row ? row.stems.toLocaleString("ru-RU") : "0"} hint="на этот день" />
          <KpiTile icon="tag" label="По внутренней цене" value={money(row?.amount ?? 0)} hint="это не выручка" />
          <KpiTile
            icon="truck"
            label="Последняя отправка"
            value={history[0] ? formatDay(history[0].deliveryDate) : "—"}
            hint={history[0] ? `${history[0].items.reduce((s, i) => s + i.quantity, 0).toLocaleString("ru-RU")} шт.` : "ещё не отправляли"}
          />
        </div>
      )}

      {/* Новый вид (19.10.2026): город — вкладкой карточки, ниже день; слева заявка дня, справа последние отправки. */}
      <div className="card !p-0 overflow-hidden">
        <CityTabs cities={[...RETAIL_REGION_CITIES]} current={city} date={date} />
        <div className="px-4 py-3 border-b border-line-hairline">
          <DayNav date={date} today={dayKey(new Date())} basePath="/retail/regions" extra={{ city }} />
        </div>

        {!card ? (
          <p className="px-4 sm:px-5 py-10 text-center text-sm text-ink-secondary">
            Города «{city}» ещё нет в базе — его заводит РОП или администратор.
          </p>
        ) : (
          <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                    <th className="px-4 py-2.5 font-medium">Заявка</th>
                    <th className="px-4 py-2.5 font-medium">Что заказано</th>
                    <th className="px-4 py-2.5 font-medium text-right">Стеблей</th>
                    <th className="px-4 py-2.5 font-medium text-right">Сумма</th>
                    <th className="px-4 py-2.5 font-medium">Готовность</th>
                  </tr>
                </thead>
                <tbody>
                  {(row?.orders ?? []).map((o) => (
                    <tr key={o.orderId} className="border-b border-line-hairline last:border-0 align-top hover:bg-surface-plane">
                      <td data-label="Заявка" className="px-4 py-2.5 whitespace-nowrap">
                        <Link href={`/orders/${o.orderId}`} className="font-semibold font-mono hover:text-section-retail">
                          № {orderCode(o.orderId)}
                        </Link>
                      </td>
                      <td data-label="Что заказано" className="px-4 py-2.5 text-ink-secondary">
                        {o.positions || "—"}
                      </td>
                      <td data-label="Стеблей" className="px-4 py-2.5 text-right tabular-nums">
                        {o.stems.toLocaleString("ru-RU")}
                      </td>
                      <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums">
                        {money(o.amount)}
                      </td>
                      <td data-label="Готовность" className="px-4 py-2.5">
                        {o.managerConfirmed ? <Pill tone="good">подтверждена</Pill> : <Pill tone="wait">ждёт подтверждения</Pill>}
                      </td>
                    </tr>
                  ))}
                  {(!row || row.empty) && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                        Заявки на этот день нет.
                        {canOrder && (
                          <div className="mt-3">
                            <Link href={`/orders/new?retail=1&client=${card.clientId}&date=${date}`} className="btn-primary">
                              Оформить заявку в {city}
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t xl:border-t-0 xl:border-l border-line-hairline min-w-0">
              <div className="px-4 sm:px-5 py-3 border-b border-line-hairline font-display text-[15px] font-bold">
                Последние отправки в {city}
              </div>
              {history.length === 0 ? (
                <p className="px-4 sm:px-5 py-6 text-sm text-ink-muted">Ещё не отправляли.</p>
              ) : (
                <ul className="divide-y divide-line-hairline">
                  {history.map((o) => (
                    <li key={o.orderId} className="px-4 sm:px-5 py-2.5 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/orders/${o.orderId}`} className="font-medium hover:text-section-retail">
                          {formatDay(o.deliveryDate)}
                          <span className="ml-2 text-[11px] text-ink-muted font-mono">№ {orderCode(o.orderId)}</span>
                        </Link>
                        <span className="tabular-nums whitespace-nowrap">
                          {o.items.reduce((s, i) => s + i.quantity, 0).toLocaleString("ru-RU")} шт.
                        </span>
                      </div>
                      <div
                        className="text-xs text-ink-muted truncate"
                        title={o.items.map((i) => `${i.variety} ${formatGrade(i.grade)} — ${i.quantity}`).join(", ")}
                      >
                        {o.items.map((i) => `${i.variety} ${formatGrade(i.grade)} — ${i.quantity}`).join(", ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
