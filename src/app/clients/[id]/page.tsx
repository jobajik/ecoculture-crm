import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientById, listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { FLOWER_TYPE_LABELS, ROLES, SHEET_TABS, farmLabel, formatGrade } from "@/lib/constants";
import { orderStage } from "@/lib/orderStage";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import Pill from "@/components/Pill";
import { orderPayState } from "@/lib/orderPay";
import PageHeader from "@/components/PageHeader";
import ClientOrdersPanel, { type PanelKaspi, type PanelMessage, type PanelOrder, type PanelPayment } from "@/components/ClientOrdersPanel";
import { prefetchTables } from "@/lib/sheets";
import { listPayments } from "@/lib/repo/payments";
import { listKaspiInvoices } from "@/lib/repo/kaspiInvoices";
import { listWaMessages } from "@/lib/repo/talks";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiStatusLabel } from "@/lib/kaspiInvoice";
import { phoneKey } from "@/lib/leads";
import ClientCard from "@/components/ClientCard";
import Icon, { type IconName } from "@/components/Icon";
import { orderCode } from "@/lib/paymentStage";
import { canSeeShop, isOwnShop, isRetailRole } from "@/lib/retail";
import { withBotName } from "@/lib/botIdentity";
import { canCreateClientOrder, canRepeatFrom, newClientOrderHref } from "@/lib/repeatOrder";
import { dueDateOf } from "@/lib/debtReminder";
import KpiTile from "@/components/KpiTile";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { edit?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (
    role !== ROLES.MANAGER &&
    role !== ROLES.SALES_HEAD &&
    role !== ROLES.ADMIN &&
    !isRetailRole(role)
  ) {
    redirect("/?error=forbidden");
  }

  const client = await getClientById(params.id);
  if (!client) notFound();

  // Карточка магазина открыта только своей рознице, РОПу и админу; менеджеру
  // розницы, наоборот, доступны ТОЛЬКО магазины его направления.
  const shop = isOwnShop(client);
  if (shop && role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD && !canSeeShop(role, client)) {
    notFound();
  }
  // Менеджеру розницы из клиентов открыты только СВОИ карточки: он продаёт
  // мелким клиентам, которых сам и завёл.
  if (!shop && isRetailRole(role) && client.managerEmail !== (session?.user?.email ?? "").toLowerCase()) {
    notFound();
  }

  // Все вкладки карточки — одним чтением (грабли 1.17): заявки, клиенты, платежи, счета Kaspi, переписка.
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.KASPI_INVOICES,
    SHEET_TABS.WA_MESSAGES,
  ]).catch(() => {});
  const [clients, orders, users, payments, invoices, messages] = await Promise.all([
    listClients(),
    listOrdersWithItems(),
    listUsers(),
    listPayments().catch(() => []),
    listKaspiInvoices().catch(() => []),
    listWaMessages({ lines: "all" }).catch(() => []),
  ]);
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email, u.name || u.email])));

  const stats = buildClientStats({
    clients,
    orders,
    nameByEmail,
    positionLabel: (flowerType, grade) =>
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} ${formatGrade(grade)}`,
  });
  const row = stats.rows.find((r) => r.client.clientId === client.clientId);

  // История заказов клиента — свежие сверху: смотрят обычно последние.
  const myOrders = orders
    .filter((o) => o.clientId === client.clientId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const email = session?.user?.email?.toLowerCase() ?? "";
  const canEdit =
    role === ROLES.ADMIN ||
    role === ROLES.SALES_HEAD ||
    client.managerEmail === email ||
    // Магазин ведёт вся розница своего направления, а не только тот, кто завёл
    // карточку: людей там мало, и «чужая карточка» между двумя коллегами одного
    // направления означала бы просто неисправимую опечатку.
    (shop && canSeeShop(role, client));
  // «+ Заявка» прямо с карточки: клиент уже подставлен.
  const newOrderHref =
    !shop && client.active && canCreateClientOrder(role) ? newClientOrderHref(role, client.clientId) : "";

  // Деньги по клиенту полосой (новый вид, 19.10.2026): оплачено / ждём (срок не вышел) / просрочено — по продажам,
  // без отменённых, перемещений и объёма на город. Срок — день доставки плюс отсрочка клиента (`dueDateOf`).
  const today = localDayKey();
  const money3 = { paid: 0, waiting: 0, overdue: 0 };
  const payOf = new Map(myOrders.map((o) => [o.orderId, orderPayState(o, today)]));
  for (const p of Array.from(payOf.values())) {
    money3.paid += p.paid;
    if (p.late) money3.overdue += p.debt;
    else money3.waiting += p.debt;
  }
  const moneyTotal = money3.paid + money3.waiting + money3.overdue;

  // Четыре плитки сверху (19.10.2026, макет принят владельцем): за 30 дней (и к прошлым 30), долг и ближайший срок,
  // последняя заявка и её этап, «обычно берёт». Всё — из уже прочитанных заявок, без новых чтений.
  const dayMs = 86_400_000;
  const since = (days: number) => new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
  const saleOrders = myOrders.filter((o) => payOf.get(o.orderId)?.sale);
  const sumIn = (from: string, to: string) =>
    saleOrders.filter((o) => o.createdAt.slice(0, 10) >= from && o.createdAt.slice(0, 10) < to).reduce((sum, o) => sum + o.totalAmount, 0);
  const last30 = sumIn(since(30), "9999");
  const prev30 = sumIn(since(60), since(30));
  const delta30 = prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 100) : null;
  const debtNow = money3.waiting + money3.overdue;
  const nearestDue = saleOrders
    .filter((o) => (payOf.get(o.orderId)?.debt ?? 0) > 0)
    .map((o) => dueDateOf(o))
    .filter(Boolean)
    .sort()[0];
  const lastOrder = myOrders.find((o) => o.status !== "cancelled") ?? myOrders[0];
  const lastStage = lastOrder ? orderStage(lastOrder, today) : null;
  const repeatHref =
    lastOrder && canRepeatFrom(lastOrder, role, email) ? newClientOrderHref(role, client.clientId, lastOrder.orderId) : "";
  const share = (v: number) => (moneyTotal > 0 ? (v / moneyTotal) * 100 : 0);
  const status = !row
    ? null
    : row.neverOrdered
      ? ({ tone: "muted", label: "Ещё не заказывал" } as const)
      : row.sleeping
        ? ({ tone: "wait", label: `Молчит с ${formatDay(row.lastOrderDate)}` } as const)
        : ({ tone: "good", label: "Покупает" } as const);
  const managerName = nameByEmail.get(client.managerEmail) ?? client.managerEmail;
  const phoneDigits = client.phone.replace(/[^\d+]/g, "");
  const waDigits = client.phone.replace(/\D/g, "");

  const editing = searchParams?.edit === "1" && canEdit;
  const ids = new Set(myOrders.map((o) => o.orderId));
  const codeOf = (id: string) => orderCode(id);
  const panelOrders: PanelOrder[] = myOrders.map((o) => {
    const pay = payOf.get(o.orderId)!;
    const first = o.items[0];
    return {
      orderId: o.orderId,
      code: codeOf(o.orderId),
      date: (o.deliveryDate || o.createdAt).slice(0, 10),
      item: first ? `${first.variety}, ${formatGrade(first.grade)} · ${first.quantity.toLocaleString("ru-RU")}` : "—",
      more: Math.max(0, o.items.length - 1),
      total: o.totalAmount,
      paid: Math.min(o.paidAmount, o.totalAmount),
      payTone: pay.tone,
      payLabel: pay.label,
      stage: orderStage(o, today),
    };
  });
  const panelPayments: PanelPayment[] = payments
    .filter((p) => ids.has(p.orderId))
    .map((p) => ({
      id: p.paymentId,
      date: p.date,
      amount: p.amount,
      method: p.method,
      farm: p.farm ? farmLabel(p.farm) : "",
      orderId: p.orderId,
      code: codeOf(p.orderId),
    }));
  const panelKaspi: PanelKaspi[] = invoices
    .filter((k) => ids.has(k.orderId))
    .map((k) => ({
      id: k.invoiceId,
      date: k.createdAt.slice(0, 10),
      amount: k.amount,
      phone: k.phone,
      statusLabel: kaspiStatusLabel(k.status),
      tone: isPaidKaspiStatus(k.status) ? "good" : isOpenKaspiStatus(k.status) ? "wait" : k.status === "error" ? "bad" : "muted",
      orderId: k.orderId,
      code: codeOf(k.orderId),
    }));
  const phoneKeys = new Set([client.phone, client.kaspiPay1, client.kaspiPay2].map((v) => phoneKey(v)).filter(Boolean));
  const panelMessages: PanelMessage[] = messages
    .filter((m) => phoneKeys.has(phoneKey(m.phone)))
    .map((m) => ({ id: m.messageId, at: m.at, out: m.direction === "out", text: m.text, who: m.senderName && m.direction === "out" ? m.senderName : "" }));
  const kaspiNumbers = [client.kaspiPay1, client.kaspiPay2].filter(Boolean);

  return (
    <div>
      <PageHeader
        area="clients"
        title={client.name}
        eyebrow={shop ? "Наши магазины" : undefined}
        actions={
          <>
            {waDigits.length >= 10 && (
              <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="btn-secondary">
                <Icon name="message" className="w-4 h-4" />
                WhatsApp
              </a>
            )}
            {repeatHref && (
              <Link href={repeatHref} className="btn-secondary">
                Повторить последнюю
              </Link>
            )}
            {newOrderHref && (
              <Link href={newOrderHref} className="btn-primary">
                + Новая заявка
              </Link>
            )}
          </>
        }
      />

      {row && !editing && !shop && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <KpiTile
            icon="wallet"
            label="За 30 дней"
            value={money(last30)}
            hint={delta30 === null ? (prev30 === 0 && last30 > 0 ? "раньше не заказывал" : "за прошлые 30 дней — ничего") : `${delta30 >= 0 ? "+" : ""}${delta30} % к прошлым 30 дням`}
            tone={delta30 !== null && delta30 < 0 ? "warn" : delta30 !== null && delta30 > 0 ? "good" : undefined}
          />
          <KpiTile
            icon="clock"
            label="Долг"
            value={debtNow > 0 ? money(debtNow) : "нет"}
            hint={
              money3.overdue > 0
                ? `просрочено ${money(money3.overdue)}`
                : nearestDue
                  ? nearestDue < today
                    ? "срок вышел"
                    : nearestDue === today
                      ? "срок оплаты сегодня"
                      : `срок оплаты ${formatDay(nearestDue)}`
                  : "всё оплачено"
            }
            tone={money3.overdue > 0 ? "bad" : debtNow > 0 ? "warn" : "good"}
            href={debtNow > 0 ? "/finance/debts" : undefined}
          />
          <KpiTile
            icon="order"
            label="Последняя заявка"
            value={lastOrder ? formatDay(lastOrder.createdAt) : "—"}
            hint={lastOrder && lastStage ? `№ ${orderCode(lastOrder.orderId)} · ${lastStage.label.toLowerCase()}` : "заявок ещё не было"}
            href={lastOrder ? `/orders/${lastOrder.orderId}` : undefined}
          />
          <KpiTile
            icon="leaf"
            label="Обычно берёт"
            value={<span className="text-[16px] sm:text-[18px] leading-snug">{row.topPosition || "—"}</span>}
            hint={row.orders > 0 ? `${row.orders} заявок · средний чек ${money(row.avgCheck)}` : "ещё не заказывал"}
          />
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Слева — кто это (прототип владельца): о клиенте, доставка, номера Kaspi. Анкета целиком — по «Действиям». */}
        <div className="w-full lg:w-[360px] lg:flex-none space-y-4">
          {editing ? (
            <>
              <Link href={`/clients/${client.clientId}`} className="text-sm text-ink-secondary hover:underline">
                ← К карточке
              </Link>
              <ClientCard
                clientId={client.clientId}
                canEdit={canEdit}
                startEditing
                canSetRetail={role === ROLES.ADMIN || role === ROLES.SALES_HEAD}
                managerName={managerName}
                values={{
                  name: client.name,
                  city: client.city,
                  shopName: client.shopName,
                  clientType: client.clientType,
                  contactPerson: client.contactPerson,
                  phone: client.phone,
                  messenger: client.messenger,
                  address: client.address,
                  paymentTerms: client.paymentTerms,
                  paymentMethod: client.paymentMethod,
                  kaspiPay1: client.kaspiPay1,
                  kaspiPay2: client.kaspiPay2,
                  retail: client.retail,
                  source: client.source,
                  note: client.note,
                }}
              />
            </>
          ) : (
            <>
              <div className="card !p-0">
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line-hairline">
                  <span className="w-8 h-8 rounded-lg grid place-items-center bg-section-client-soft text-section-client flex-none">
                    <Icon name="client" className="w-4 h-4" />
                  </span>
                  <h2 className="font-display text-[15px] font-bold">О клиенте</h2>
                </div>
                <div className="p-4">
                  <details className="group relative mb-4">
                    <summary className="list-none cursor-pointer flex items-center gap-2 rounded-xl border border-line-hairline bg-surface-plane px-3 py-2 text-sm font-semibold select-none">
                      <Icon name="list" className="w-4 h-4 text-ink-secondary" />
                      Действия
                      <span className="ml-auto text-ink-muted transition-transform group-open:rotate-180">▾</span>
                    </summary>
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl border border-line-hairline bg-surface shadow-card-hover py-1 text-sm">
                      {newOrderHref && (
                        <Link href={newOrderHref} className="block px-3 py-2 hover:bg-surface-plane">
                          + Новая заявка
                        </Link>
                      )}
                      {canEdit && (
                        <Link href={`/clients/${client.clientId}?edit=1`} className="block px-3 py-2 hover:bg-surface-plane">
                          Изменить анкету
                        </Link>
                      )}
                      {client.phone && (
                        <a href={`tel:${phoneDigits}`} className="block px-3 py-2 hover:bg-surface-plane">
                          Позвонить
                        </a>
                      )}
                      {waDigits.length >= 10 && (
                        <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="block px-3 py-2 hover:bg-surface-plane">
                          Написать в WhatsApp
                        </a>
                      )}
                      <Link href={shop ? "/retail/shops" : "/clients"} className="block px-3 py-2 hover:bg-surface-plane text-ink-secondary">
                        {shop ? "Все магазины" : "Все клиенты"}
                      </Link>
                    </div>
                  </details>
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-xl bg-section-client-soft text-section-client grid place-items-center font-display font-extrabold text-lg flex-none">
                      {client.name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0">
                      <div className="font-display font-bold text-[16px] leading-tight break-words">{client.name}</div>
                      <div className="text-xs text-ink-muted mt-0.5">
                        {[client.clientType, client.city].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    {status && (
                      <span className="ml-auto">
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 mt-4 text-sm">
                    <Fact icon="client" label="Менеджер">
                      {managerName || "—"}
                    </Fact>
                    <Fact icon="phone" label="Телефон">
                      {client.phone ? (
                        <a href={`tel:${phoneDigits}`} className="hover:text-section-client">
                          {client.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Fact>
                    <Fact icon="card" label="Чем платит">
                      {client.paymentMethod || "—"}
                    </Fact>
                    <Fact icon="clock" label="Условия">
                      {client.paymentTerms || "—"}
                    </Fact>
                    {row && !row.neverOrdered && (
                      <>
                        <Fact icon="leaf" label="Обычно берёт">
                          {row.topPosition || "—"}
                        </Fact>
                        <Fact icon="calendar" label="Последний заказ">
                          {formatDay(row.lastOrderDate)}
                        </Fact>
                      </>
                    )}
                  </dl>
                </div>
              </div>

              <div className="card !p-0">
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line-hairline">
                  <span className="w-8 h-8 rounded-lg grid place-items-center bg-section-client-soft text-section-client flex-none">
                    <Icon name="truck" className="w-4 h-4" />
                  </span>
                  <h2 className="font-display text-[15px] font-bold">Доставка</h2>
                  {canEdit && (
                    <Link href={`/clients/${client.clientId}?edit=1`} className="ml-auto text-ink-muted hover:text-ink-primary text-lg leading-none" title="Изменить">
                      +
                    </Link>
                  )}
                </div>
                <div className="p-3 space-y-2.5">
                  <AddressBox
                    icon="truck"
                    title="Адрес доставки"
                    lines={[client.address || "не указан", [client.city, client.shopName].filter(Boolean).join(" · ")]}
                    active={!!client.address}
                  />
                  {(client.contactPerson || client.messenger) && (
                    <AddressBox
                      icon="client"
                      title={client.contactPerson || "Контакт"}
                      lines={[client.messenger, client.note].filter(Boolean)}
                    />
                  )}
                </div>
              </div>

              {kaspiNumbers.length > 0 && (
                <div className="card !p-0">
                  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line-hairline">
                    <span className="rounded-md bg-kaspi-soft text-kaspi text-[11px] font-bold px-2 py-0.5">Kaspi</span>
                    <h2 className="font-display text-[15px] font-bold">Номера для счёта</h2>
                  </div>
                  {kaspiNumbers.map((n, i) => (
                    <div key={n} className="flex items-center gap-3 px-4 py-2.5 border-b border-line-hairline last:border-0 text-sm">
                      <span className="text-ink-muted w-7">№{i + 1}</span>
                      <b>{n}</b>
                      {i === 0 && <span className="ml-auto text-[11px] rounded-full bg-surface-sunk px-2 py-0.5 text-ink-secondary">основной</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Справа — деньги и всё по клиенту одной карточкой с вкладками. */}
        <div className="w-full min-w-0 flex-1 space-y-4">
          {row && (
            <div className="card">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <h2 className="font-display text-[15px] font-bold mr-auto">Деньги по клиенту</h2>
                <span className="text-sm text-ink-secondary">
                  Заявок на <b className="font-display font-extrabold text-ink-primary">{money(row.revenue)}</b>
                </span>
                <span className="text-sm text-ink-secondary">
                  Всего заявок <b className="font-display font-extrabold text-ink-primary">{row.orders}</b>
                </span>
              </div>
              {moneyTotal > 0 ? (
                <>
                  <div className="flex h-2.5 gap-[3px] rounded-full overflow-hidden mt-4 mb-3 bg-surface-sunk">
                    {money3.paid > 0 && <span className="bg-status-good rounded-full" style={{ width: `${share(money3.paid)}%` }} />}
                    {money3.waiting > 0 && <span className="bg-status-warning rounded-full" style={{ width: `${share(money3.waiting)}%` }} />}
                    {money3.overdue > 0 && <span className="bg-status-critical rounded-full" style={{ width: `${share(money3.overdue)}%` }} />}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-ink-secondary">
                    <Legend color="bg-status-good" label="Оплачено" value={money(money3.paid)} />
                    <Legend color="bg-status-warning" label="Ждём" value={money(money3.waiting)} />
                    <Legend color="bg-status-critical" label="Просрочено" value={money(money3.overdue)} />
                    {row.orders > 0 && (
                      <span className="sm:ml-auto">
                        Средний чек <b className="font-display font-extrabold text-ink-primary">{money(row.avgCheck)}</b>
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-muted mt-3">Счетов пока не было.</p>
              )}
            </div>
          )}

          <ClientOrdersPanel
            clientName={client.name}
            orders={panelOrders}
            payments={panelPayments}
            kaspi={panelKaspi}
            messages={panelMessages}
          />
        </div>
      </div>
    </div>
  );
}

function AddressBox({ icon, title, lines, active }: { icon: IconName; title: string; lines: string[]; active?: boolean }) {
  return (
    <div
      className={
        active
          ? "flex gap-3 rounded-xl border border-section-client/30 bg-section-client-soft/60 px-3.5 py-3"
          : "flex gap-3 rounded-xl border border-line-hairline px-3.5 py-3"
      }
    >
      <span className="w-8 h-8 rounded-lg border border-line-hairline bg-surface grid place-items-center text-ink-secondary flex-none">
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <div className="min-w-0 text-sm">
        <div className="font-semibold">{title}</div>
        {lines.filter(Boolean).map((l, i) => (
          <div key={i} className="text-xs text-ink-secondary mt-0.5 break-words">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-ink-muted mb-1">
        <Icon name={icon} className="w-3.5 h-3.5" />
        {label}
      </dt>
      <dd className="font-semibold break-words">{children}</dd>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      {label} <b className="font-display font-extrabold text-ink-primary">{value}</b>
    </span>
  );
}
