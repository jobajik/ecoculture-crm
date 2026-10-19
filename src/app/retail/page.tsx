import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ORDER_STATUSES, formatGrade } from "@/lib/constants";
import { buildShopDay, isRetailRole, retailShortLabel, territoriesFor } from "@/lib/retail";
import PageHeader from "@/components/PageHeader";
import { retailTabsFor } from "./tabs";
import DayNav from "@/components/DayNav";
import KpiTile from "@/components/KpiTile";
import RetailDayBoard, { type RetailDayRow } from "@/components/RetailDayBoard";
import { formatDay } from "@/lib/formatDate";
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
  const boardRows: RetailDayRow[] = rows.map((r) => ({
    ...r,
    sub: [r.city, territories.length > 1 ? retailShortLabel(r.territory) : ""].filter(Boolean).join(" · "),
  }));

  // Новый вид (19.10.2026): цифры дня плитками, ниже одна карточка — день, отбор «без заявки» и страницы.
  return (
    <div>
      <PageHeader
        area="retail"
        title={`Розница${territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}`}
        tabs={retailTabsFor(role)}
        actions={
          canOrder && (
            <div className="flex flex-wrap gap-2">
              {isRetailRole(role) && (
                <Link href="/orders/new?sale=1" className="btn-secondary">
                  + Заявка клиенту
                </Link>
              )}
              <Link href={`/orders/new?retail=1&date=${date}`} className="btn-primary">
                + Заявка магазину
              </Link>
            </div>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="store" label="Магазинов" value={String(totals.shops)} hint={formatDay(date)} />
        <KpiTile
          icon="check"
          label="Заявка есть"
          value={`${totals.covered} из ${totals.shops}`}
          hint={missing > 0 ? `${missing} без заявки` : "все закрыты"}
          tone={missing > 0 ? "bad" : "good"}
        />
        <KpiTile icon="leaf" label="Стеблей" value={totals.stems.toLocaleString("ru-RU")} hint="на этот день" />
        <KpiTile icon="tag" label="По внутренней цене" value={money(totals.amount)} hint="это не выручка" />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line-hairline">
          <DayNav date={date} today={todayKey()} />
        </div>
        <RetailDayBoard rows={boardRows} date={date} canOrder={canOrder} />
      </div>
    </div>
  );
}
