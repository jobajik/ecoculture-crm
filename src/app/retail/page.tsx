import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ORDER_STATUSES, formatGrade } from "@/lib/constants";
import { buildShopDay, isRetailRole, retailShortLabel, territoriesFor } from "@/lib/retail";
import { formatDay } from "@/lib/formatDate";
import SectionTabs from "@/components/SectionTabs";
import { RETAIL_TABS } from "./tabs";
import RetailDayNav from "@/components/RetailDayNav";
import { ROLES } from "@/lib/constants";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * «Заявка на день по магазинам» — рабочее место менеджера розницы.
 *
 * Он не оформляет двенадцать разрозненных заявок и не держит в голове, кому
 * уже отправил, а кому нет. Он смотрит на день доставки и видит все свои точки
 * списком: у кого заявка есть, у кого пусто. **Пустая строка здесь — не
 * отсутствие данных, а напоминание**, и ради неё страница и сделана: забытый
 * магазин остаётся без цветка, и узнают об этом утром на погрузке.
 *
 * По умолчанию открывается на ЗАВТРА, а не на сегодня: заявку на магазины
 * собирают накануне. Лист сборки склада, наоборот, открывается на сегодня — там
 * вопрос другой, «что сейчас набрать из холодильника».
 */
export default async function RetailDayPage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const territories = territoriesFor(role);
  if (territories.length === 0) redirect("/?error=forbidden");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const date =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : defaultDate;

  const [clients, orders] = await Promise.all([listClients(), listOrdersWithItems()]);

  const { rows, totals } = buildShopDay({
    shops: clients.map((c) => ({
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
    territories,
    positionLabel: (variety, grade) => `${variety} ${formatGrade(grade)}`,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  const canOrder = isRetailRole(role) || role === ROLES.ADMIN;
  const missing = rows.filter((r) => r.empty).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">
          Розница{territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}
        </h1>
        {canOrder && (
          <Link href="/orders/new" className="btn-primary">
            + Заявка магазину
          </Link>
        )}
      </div>
      <SectionTabs tabs={RETAIL_TABS} />

      <p className="text-sm text-ink-secondary mt-4 mb-3">
        Заявки на доставку {formatDay(date)}. Это наши магазины: оплата по таким заявкам не
        проводится — отгрузку открывает ваше подтверждение.
      </p>

      <RetailDayNav date={date} today={todayKey()} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 my-4">
        <Tile title="Магазинов" value={String(totals.shops)} hint="В вашем направлении" />
        <Tile
          title="Заявка есть"
          value={`${totals.covered} из ${totals.shops}`}
          hint={missing > 0 ? `${missing} без заявки` : "Все закрыты"}
          warn={missing > 0}
        />
        <Tile title="Стеблей" value={totals.stems.toLocaleString("ru-RU")} hint="На этот день" />
        <Tile title="По внутренней цене" value={money(totals.amount)} hint="Это не выручка" />
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Магазин</th>
              <th className="px-4 py-3 font-medium">Что заказано</th>
              <th className="px-4 py-3 font-medium text-right">Стеблей</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium">Готовность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.clientId}
                className="border-b border-line-hairline last:border-0 hover:bg-surface-plane"
              >
                <td className="px-4 py-2.5 align-top">
                  <Link href={`/clients/${row.clientId}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                  <div className="text-xs text-ink-muted">
                    {[row.city, territories.length > 1 ? retailShortLabel(row.territory) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top text-ink-secondary">
                  {row.empty ? (
                    <span className="text-[#8a5a00]">заявки на этот день нет</span>
                  ) : (
                    row.orders.map((o) => (
                      <div key={o.orderId}>
                        <Link href={`/orders/${o.orderId}`} className="hover:underline">
                          {o.positions || "без позиций"}
                        </Link>
                      </div>
                    ))
                  )}
                </td>
                <td className="px-4 py-2.5 align-top text-right tabular-nums">
                  {row.stems > 0 ? row.stems.toLocaleString("ru-RU") : "—"}
                </td>
                <td className="px-4 py-2.5 align-top text-right tabular-nums">
                  {row.amount > 0 ? money(row.amount) : "—"}
                </td>
                <td className="px-4 py-2.5 align-top">
                  {row.empty ? (
                    canOrder ? (
                      <Link href="/orders/new" className="text-xs hover:underline text-accent">
                        оформить
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )
                  ) : row.orders.every((o) => o.managerConfirmed) ? (
                    <span className="text-xs text-status-good">✓ подтверждена</span>
                  ) : (
                    <span className="text-xs text-[#8a5a00]">ждёт вашего подтверждения</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                  Магазинов в вашем направлении пока нет. Карточку магазина заводит РОП — или вы
                  сами, кнопкой «Заявка магазину».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
