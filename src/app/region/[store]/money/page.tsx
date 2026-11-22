import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import Pill from "@/components/Pill";
import Hint from "@/components/Hint";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { ORDER_STATUSES } from "@/lib/constants";
import { cityClientOrders, cityMoney, retailCardsOf, truckKindOf } from "@/lib/regionTruck";
import { orderPayState } from "@/lib/orderPay";
import { orderCode } from "@/lib/paymentStage";
import { storeLabel } from "@/lib/officeStore";
import { formatDay } from "@/lib/formatDate";
import { moneyExact } from "@/lib/formatNumber";
import { addDaysToKey } from "@/lib/dayKey";
import { localDayKey } from "@/lib/timezone";
import { loadRegion } from "../../load";

export const dynamic = "force-dynamic";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/**
 * «Оплаты и долги» города (17.11.2026, владелец выбрал: директор видит цены, заявки, оплаты и долги города). ТОЛЬКО
 * просмотр: платёж вносит и счёт выставляет бухгалтер. Заявки города — со склада города, клиенту из этого города или с
 * направлением в этот город (`cityClientOrders`); перемещения в наши магазины и объём на город — без счёта, их здесь нет.
 */
export default async function RegionMoneyPage({ params }: { params: { store: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const base = `/region/${r.store}`;
  if (!r.access.money) {
    return (
      <div>
        <PageHeader area="stock" title={`Оплаты и долги — ${r.info.label}`} icon="wallet" tabs={r.headerTabs} />
        {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/money`} />}
        <p className="card text-sm text-ink-secondary">Оплаты и долги города видит менеджер города, РОП и администратор.</p>
      </div>
    );
  }
  const [orders, clients] = await Promise.all([listOrdersWithItems(), listClients()]);
  const cityOf = new Map(clients.map((c) => [c.clientId, c.city]));
  const mine = cityClientOrders(orders, r.store, (id) => cityOf.get(id));
  const rows = mine
    .map((o) => {
      const pay = orderPayState(o, r.today);
      return { o, pay, day: o.createdAt ? localDayKey(new Date(o.createdAt)) : "" };
    })
    .filter((x) => x.o.status !== ORDER_STATUSES.CANCELLED);
  const month = r.today.slice(0, 7);
  const m = cityMoney({ orders: rows.map((x) => ({ ...x.o, createdAt: x.day, debt: x.pay.debt, late: x.pay.late })), month });
  const debts = rows.filter((x) => x.pay.debt > 0).sort((a, b) => Number(b.pay.late) - Number(a.pay.late) || (a.day < b.day ? -1 : 1));
  const since = addDaysToKey(r.today, -30);
  const recentAll = rows.filter((x) => x.day >= since).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.o.createdAt < b.o.createdAt ? 1 : -1));
  // Длинный месяц не превращаем в простыню: последние 60, остальное — в «Заявках».
  const recent = recentAll.slice(0, 60);
  // Опт города: объём без цен, деньги по нему вписывает бухгалтер («Поступления по городу»).
  const cards = new Set(retailCardsOf(clients, r.store).map((c) => c.clientId));
  const volume = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && truckKindOf(o, r.store, cards) === "wholesale" && (o.deliveryDate || "").slice(0, 7) === month);
  const volumeStems = volume.reduce((s, o) => s + o.items.reduce((x, i) => x + i.shippedQuantity, 0), 0);
  const volumeIncome = volume.reduce((s, o) => s + o.paidAmount, 0);
  const tenge = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1] ?? "";

  const table = (list: typeof rows, empty: string) =>
    list.length === 0 ? (
      <p className="px-4 sm:px-5 py-4 text-sm text-ink-secondary">{empty}</p>
    ) : (
      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 sm:px-5 py-2.5 font-medium">Заявка</th>
              <th className="px-3 py-2.5 font-medium">Клиент</th>
              <th className="px-3 py-2.5 font-medium">Менеджер</th>
              <th className="px-3 py-2.5 font-medium">Склад</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium text-right">Оплачено</th>
              <th className="px-3 py-2.5 font-medium text-right">Долг</th>
              <th className="px-4 sm:px-5 py-2.5 font-medium">Состояние</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ o, pay, day }) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td data-label="Заявка" className="px-4 sm:px-5 py-2.5 whitespace-nowrap">
                  <Link href={`/orders/${o.orderId}`} className="font-medium tabular-nums text-accent hover:underline">
                    № {orderCode(o.orderId)}
                  </Link>
                  <span className="text-xs text-ink-muted ml-2">{formatDay(day)}</span>
                </td>
                <td data-label="Клиент" className="px-3 py-2.5">{o.clientName}</td>
                <td data-label="Менеджер" className="px-3 py-2.5 text-ink-secondary whitespace-nowrap">{r.nameOf(o.managerEmail)}</td>
                <td data-label="Склад" className="px-3 py-2.5 text-ink-secondary whitespace-nowrap">{storeLabel(o.store)}</td>
                <td data-label="Сумма" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{moneyExact(o.totalAmount)}</td>
                <td data-label="Оплачено" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{pay.paid > 0 ? moneyExact(pay.paid) : "—"}</td>
                <td data-label="Долг" className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{pay.debt > 0 ? moneyExact(pay.debt) : "—"}</td>
                <td data-label="Состояние" className="px-4 sm:px-5 py-2.5">
                  <Pill tone={pay.tone}>{pay.label}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div>
      <PageHeader area="stock" title={`Оплаты и долги — ${r.info.label}`} subtitle="Только просмотр: платежи и счета ведёт бухгалтер" icon="wallet" tabs={r.headerTabs} />
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/money`} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="list" label={`Продано за ${monthName}`} value={tenge(m.monthSales)} hint={`заявок: ${m.monthOrders}`} />
        <KpiTile icon="wallet" label={`Получено за ${monthName}`} value={tenge(m.monthPaid)} hint={m.monthSales > 0 ? `${Math.round((m.monthPaid / m.monthSales) * 100)} % от проданного` : "продаж в этом месяце нет"} />
        <KpiTile icon="clock" label="Долг сейчас" value={tenge(m.debt)} hint={m.debtOrders > 0 ? `заявок: ${m.debtOrders}` : "долгов нет"} tone={m.debt > 0 ? "warn" : "good"} />
        <KpiTile icon="alert" label="Из него просрочено" value={tenge(m.late)} hint={m.lateOrders > 0 ? `заявок: ${m.lateOrders}` : "просрочки нет"} tone={m.late > 0 ? "bad" : "good"} />
      </div>

      <div className="card !p-0 overflow-hidden mb-5">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-line-hairline">
          <h2 className="font-medium text-sm">
            Кто должен <span className="tabular-nums text-ink-muted">{debts.length}</span>
          </h2>
          <span className="ml-auto">
            <Hint>Просроченные — сверху. Срок оплаты — день доставки плюс отсрочка из карточки клиента.</Hint>
          </span>
        </div>
        {table(debts, "Долгов по клиентам города нет.")}
      </div>

      <div className="card !p-0 overflow-hidden mb-5">
        <div className="px-4 sm:px-5 py-3 border-b border-line-hairline">
          <h2 className="font-medium text-sm">
            Заявки клиентам за 30 дней <span className="tabular-nums text-ink-muted">{recentAll.length}</span>
          </h2>
        </div>
        {table(recent, "За 30 дней заявок клиентам города не было.")}
        {recentAll.length > recent.length && (
          <p className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
            Показаны последние {recent.length} из {recentAll.length}. Остальные — в разделе «Заявки».
          </p>
        )}
      </div>

      <div className="card text-sm">
        <div className="font-medium mb-1">Опт на город за {monthName}</div>
        <div className="text-ink-secondary">
          Отгружено «объёмом на город»: <b className="font-semibold text-ink-primary tabular-nums">{volumeStems.toLocaleString("ru-RU")}</b> шт. · поступления, которые вписал бухгалтер:{" "}
          <b className="font-semibold text-ink-primary tabular-nums">{tenge(volumeIncome)}</b>. У объёма на город нет цен и счёта — продажи со склада города оформляйте заявками клиентам,
          тогда они появятся в таблицах выше.
        </div>
      </div>
    </div>
  );
}
