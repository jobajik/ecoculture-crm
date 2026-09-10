import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { FLOWER_TYPE_LABELS, ORDER_STATUSES, formatGrade } from "@/lib/constants";
import { buildRetailSummary, retailShortLabel, territoriesFor } from "@/lib/retail";
import SectionTabs from "@/components/SectionTabs";
import { RETAIL_TABS } from "../tabs";

export const dynamic = "force-dynamic";

/** Сколько дней назад считаем. Столько же, сколько в аналитике хозяйства. */
const DAYS = 30;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Сколько цветка ушло в собственную розницу за 30 дней.
 *
 * Это НЕ выручка, и на странице так и написано. Выручка появится, когда магазин
 * продаст букет покупателю; здесь — объём перемещения, посчитанный по
 * внутреннему прайсу. Смешать одно с другим значило бы посчитать один и тот же
 * цветок дважды, поэтому эти цифры и живут отдельно от «Продаж» и «Аналитики».
 */
export default async function RetailSummaryPage() {
  const session = await getServerSession(authOptions);
  const territories = territoriesFor(session?.user?.role ?? "");
  if (territories.length === 0) redirect("/?error=forbidden");

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (DAYS - 1));

  const [clients, orders] = await Promise.all([listClients(), listOrdersWithItems()]);

  const summary = buildRetailSummary({
    shops: clients.map((c) => ({
      clientId: c.clientId,
      name: c.name,
      city: c.city,
      retail: c.retail,
    })),
    orders: orders.map((o) => ({
      orderId: o.orderId,
      clientId: o.clientId,
      clientName: o.clientName,
      createdAt: o.createdAt,
      status: o.status,
      retail: o.retail,
      items: o.items,
    })),
    from: dayKey(from),
    to: dayKey(to),
    territories,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  const t = summary.totals;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">
        Розница{territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}
      </h1>
      <SectionTabs tabs={RETAIL_TABS} />

      <p className="text-sm text-ink-secondary mt-4 mb-4">
        За последние {DAYS} дней, по дате оформления заявки. Суммы посчитаны по внутреннему прайсу:
        это объём переданного в магазины, а не выручка — выручка появится, когда магазин продаст
        цветок покупателю.
      </p>

      {t.orders === 0 ? (
        <div className="card text-sm text-ink-secondary">
          За этот период заявок в магазины не было.
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tile title="Заявок" value={String(t.orders)} hint="Кроме отменённых" />
            <Tile title="Магазинов" value={String(t.shops)} hint="Кому возили" />
            <Tile title="Стеблей" value={t.stems.toLocaleString("ru-RU")} hint="Передано в розницу" />
            <Tile title="По внутренней цене" value={money(t.amount)} hint="Это не выручка" />
          </div>

          {summary.byTerritory.length > 1 && (
            <div className="card !p-0 overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-secondary border-b border-line-hairline">
                    <th className="px-4 py-3 font-medium">Направление</th>
                    <th className="px-4 py-3 font-medium text-right">Заявок</th>
                    <th className="px-4 py-3 font-medium text-right">Стеблей</th>
                    <th className="px-4 py-3 font-medium text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byTerritory.map((row) => (
                    <tr key={row.territory} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2.5">{row.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.orders}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.stems.toLocaleString("ru-RU")}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="font-medium mb-2">По магазинам</h2>
          <div className="card !p-0 overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-3 font-medium">Магазин</th>
                  <th className="px-4 py-3 font-medium">Город</th>
                  <th className="px-4 py-3 font-medium text-right">Заявок</th>
                  <th className="px-4 py-3 font-medium text-right">Стеблей</th>
                  <th className="px-4 py-3 font-medium text-right">Сумма</th>
                  <th className="px-4 py-3 font-medium text-right">Доля</th>
                </tr>
              </thead>
              <tbody>
                {summary.byShop.map((row) => (
                  <tr
                    key={row.clientId || row.name}
                    className="border-b border-line-hairline last:border-0"
                  >
                    <td className="px-4 py-2.5">{row.name}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{row.city || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.orders}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.stems.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">
                      {t.stems > 0 ? `${Math.round((row.stems / t.stems) * 100)} %` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="font-medium mb-2">Что возим</h2>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-3 font-medium">Цветок</th>
                  <th className="px-4 py-3 font-medium">Сорт</th>
                  <th className="px-4 py-3 font-medium">Длина / категория</th>
                  <th className="px-4 py-3 font-medium text-right">Стеблей</th>
                  <th className="px-4 py-3 font-medium text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {summary.byVariety.map((row) => (
                  <tr
                    key={`${row.flowerType}|${row.variety}|${row.grade}`}
                    className="border-b border-line-hairline last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      {FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}
                    </td>
                    <td className="px-4 py-2.5">{row.variety}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{formatGrade(row.grade)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.stems.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="card">
      <div className="text-sm text-ink-secondary">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs text-ink-muted mt-1">{hint}</div>
    </div>
  );
}
