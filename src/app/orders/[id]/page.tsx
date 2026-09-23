import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOrderById } from "@/lib/repo/orders";
import { listShipments } from "@/lib/repo/shipments";
import { listClaims } from "@/lib/repo/claims";
import { listUsers } from "@/lib/repo/users";
import {
  FLOWER_TYPE_LABELS,
  KASPI_METHOD,
  ORDER_STATUSES,
  ROLES,
  farmLabel,
  formatGrade,
  getFarmFor,
} from "@/lib/constants";
import OrderStageBadge from "@/components/OrderStageBadge";
import { orderStage } from "@/lib/orderStage";
import { localDayKey } from "@/lib/timezone";
import { nameIndex, personName } from "@/lib/personName";
import ReadyChecks from "@/components/ReadyChecks";
import RegionIncomePanel from "@/components/RegionIncomePanel";
import { canFillRegionOrders, isConsignment, isRegionOrder } from "@/lib/orderKind";
import OrderClaims, { type OrderClaimRow } from "@/components/OrderClaims";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { isCreditTerms, isReadyToShip, notReadyReason } from "@/lib/orderReady";
import { cancelRefusal } from "@/lib/orderRules";
import { canEditOrder } from "@/lib/orderEdit";
import WarehouseItemsEdit from "@/components/WarehouseItemsEdit";
import { adjustOrderByWarehouseAction, returnOrderItemsAction } from "../actions";
import ReturnItems, { type ReturnShopOption } from "@/components/ReturnItems";
import { RETURN_CANCELLED, returnAccess } from "@/lib/orderReturn";
import { listClients } from "@/lib/repo/clients";
import { myItems, warehouseEditRefusal } from "@/lib/warehouseOrderEdit";
import { getClientById } from "@/lib/repo/clients";
import { farmPayments } from "@/lib/orderMoney";
import {
  canFillRegions,
  isOwnShop,
  farmScopeFor,
  isRetailOrder,
  isOwnClientOrder,
  isRetailRole,
  retailLabel,
  retailTerritoryFor,
} from "@/lib/retail";
import CancelOrder from "@/components/CancelOrder";
import DeleteOrder from "@/components/DeleteOrder";
import OrderDirection from "@/components/OrderDirection";
import { directionEditRefusal, directionForCity } from "@/lib/direction";
import { canDeleteOrder } from "@/lib/orderDelete";
import { listPayments } from "@/lib/repo/payments";
import PaymentPanel from "@/components/PaymentPanel";
import { canEditFinance } from "@/lib/financeAccess";
import { paymentHistory, realizationsOf } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const loaded = await getOrderById(params.id);
  if (!loaded) notFound();

  const role = session?.user?.role;
  const myEmail = session?.user?.email?.toLowerCase() ?? "";
  // Зав. складом видит только свой цветок — кроме СВОЕЙ заявки в регион: её она
  // составила сама, включая чужой цветок, и прятать от неё собственную заявку
  // было бы просто поломкой (`farmScopeFor`).
  const farm = farmScopeFor({ role, farm: session?.user?.farm, order: loaded, email: myEmail });

  // Розница и продажи наружу разделены и здесь, иначе прямая ссылка обходила бы
  // фильтр списка. Менеджер розницы видит только своё направление; обычный
  // менеджер и бухгалтер розничную заявку не открывают вовсе — им в ней нечего
  // делать, а бухгалтеру ещё и незачем: денег по ней не бывает.
  const territory = retailTerritoryFor(role);
  const retail = isRetailOrder(loaded);
  // Оптовый объём на город: клиента нет, счёта нет, а деньги подтверждает
  // бухгалтер отдельной суммой.
  const region = isRegionOrder(loaded);
  // Своя клиентская заявка менеджера розницы (мелкий заказ) — открывается.
  if (territory && !isOwnClientOrder(loaded, myEmail) && (!retail || loaded.retail !== territory)) {
    notFound();
  }
  if (retail && (role === ROLES.MANAGER || role === ROLES.ACCOUNTANT)) notFound();

  // Зав. складом видит в заявке только свои позиции. Если своего цветка в заявке
  // нет — заявка для неё не существует, чтобы нельзя было открыть её по прямой ссылке.
  const ownItems = farm
    ? loaded.items.filter((i) => getFarmFor(i.flowerType) === farm)
    : loaded.items;
  if (farm && ownItems.length === 0) notFound();

  // Заявка для зав. складом урезается до её позиций, и сумма пересчитывается.
  // Полученные деньги надо урезать в той же пропорции: оплата приходит одной
  // суммой за всю заявку, и оставить её целиком значило бы показать зав.
  // складом Есентая «получено 800 000 из 300 000» — то есть деньги за розы.
  const scopedTotal = ownItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const order = farm
    ? {
        ...loaded,
        items: ownItems,
        totalAmount: scopedTotal,
        paidAmount:
          loaded.totalAmount > 0 ? (loaded.paidAmount * scopedTotal) / loaded.totalAmount : 0,
      }
    : loaded;

  const [allShipments, allClaims, users, client, allPayments] = await Promise.all([
    listShipments(),
    listClaims(),
    listUsers(),
    loaded.clientId ? getClientById(loaded.clientId) : Promise.resolve(null),
    // Платежи нужны только тем, кто видит деньги заявки; складу — нет.
    farm || retail ? Promise.resolve([]) : listPayments(),
  ]);
  const orderPayments = allPayments
    .filter((p) => p.orderId === loaded.orderId)
    .map((p) => ({
      paymentId: p.paymentId,
      date: p.date,
      amount: p.amount,
      farm: p.farm,
      method: p.method,
      enteredOn: (p.createdAt || "").slice(0, 10),
    }));
  // Бухгалтер работает с оплатой прямо на заявке (просьба Юлии: «неудобно
  // заходить в заявку, потом искать её в неоплаченных и ставить отметку»).
  const canTakeMoney = canEditFinance(role) && !farm && !retail && !isRegionOrder(loaded);

  // Счёт по компаниям. Компанию не выбирают руками: роза и эустома идут от Rose
  // Farm, хризантема от Есентая, а в смешанной заявке счетов два, и клиент
  // платит двумя переводами. Считаем по ПОЛНОЙ заявке, а не по урезанной для
  // склада, и зав. складом этот блок не показываем: чужие деньги её не
  // касаются, а свои она видит в сумме своих позиций.
  // По заявке в наш магазин счетов нет вовсе — показывать нечего.
  const invoice = farm || retail ? [] : farmPayments(loaded);
  const kaspiOfClient =
    client && client.paymentMethod === KASPI_METHOD
      ? [client.kaspiPay1, client.kaspiPay2].filter(Boolean)
      : [];
  const shipments = allShipments.filter((s) => s.orderId === order.orderId);

  // Рекламации показываем всем, кто видит заявку: складу тоже полезно знать,
  // что по этой отгрузке была жалоба. Заводить может только свой менеджер.
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const claims: OrderClaimRow[] = allClaims
    .filter((c) => c.orderId === order.orderId)
    .map((c) => ({
      claimId: c.claimId,
      createdAt: c.createdAt,
      reason: c.reason,
      comment: c.comment,
      status: c.status,
      decidedAt: c.decidedAt,
      decision: c.decision,
      managerName: nameByEmail.get(c.managerEmail) ?? c.managerEmail,
    }));
  const canCreateClaim =
    role === ROLES.ADMIN ||
    (role === ROLES.MANAGER && order.managerEmail === session?.user?.email?.toLowerCase());
  // Отгружает только склад, и только по заявке, которую подтвердил менеджер и
  // провёл бухгалтер. Менеджеру кнопка не нужна вовсе: он не собирает цветок.
  const isWarehouse = role === "warehouse" || role === "admin";
  const openOrder = order.status !== "shipped" && order.status !== "cancelled";
  const ready = isReadyToShip(order);
  const canShip = isWarehouse && openOrder && ready;
  const shipBlockedReason = isWarehouse && openOrder && !ready ? notReadyReason(order) : "";
  // Этап и «чей ход» — та же функция, что в списках (`orderStage`).
  const stage = orderStage(order, localDayKey());
  const managerNames = nameIndex(users);
  // Кнопку отмены показываем только тому, кто действительно может отменить, —
  // правила те же, что проверит сервер (src/lib/orderRules.ts).
  const canCancel = cancelRefusal(order, role, session?.user?.email) === "";
  // Кнопка правки — по тому же правилу, что проверит сервер. Заявку, урезанную
  // до своего цветка (зав. складом), править отсюда нельзя: она видит не всю
  // заявку, и «сохранить» стёрло бы чужие позиции. Поэтому правила спрашиваем
  // по ПОЛНОЙ заявке, а кнопку показываем, только когда показана она вся.
  // Исключение — свой опт на город у зав. складом: он заведён только её цветком,
  // значит показан целиком, и править его ей можно.
  const shownWhole = !farm || (region && order.items.length === loaded.items.length);
  const canEdit = shownWhole && canEditOrder(loaded, role, session?.user?.email);

  // Правка склада — отдельная дверь с отдельными правилами: свой цветок, только
  // количество, ростовка и цена. Считаем по ПОЛНОЙ заявке (`loaded`), а не по
  // урезанной под производство: чужие позиции не правятся, но их сумма входит
  // в итог, и без неё «сумма станет» показывала бы не ту цифру.
  const canWarehouseAdjust = warehouseEditRefusal(loaded, role, session?.user?.farm ?? null) === "";
  const warehouseItems = myItems(loaded, session?.user?.farm ?? null);
  const otherItemsTotal = loaded.items
    .filter((i) => !warehouseItems.some((m) => m.itemId === i.itemId))
    .reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  // Возврат и перемещение в наш магазин (src/lib/orderReturn.ts): менеджер своей
  // заявки, зав. складом по своему цветку, администратор. Правила считаются по
  // ПОЛНОЙ заявке: без чужих строк не понять, опустеет ли она после возврата.
  const returnRights = returnAccess(loaded, role, myEmail, session?.user?.farm ?? null);
  const returnShops: ReturnShopOption[] =
    returnRights.refusal === "" && returnRights.canMove
      ? (await listClients())
          .filter((c) => isOwnShop(c) && c.active)
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map((c) => ({ clientId: c.clientId, name: c.name, retail: c.retail }))
      : [];
  // Складу чужие строки нужны только чтобы понять «опустеет ли заявка»: цену,
  // сорт и ростовку чужого цветка в страницу не отдаём (грабли 1.1-ter).
  const returnOrder = {
    ...loaded,
    items: loaded.items.map((i) =>
      returnRights.itemIds.includes(i.itemId) ? i : { ...i, unitPrice: 0, variety: "", grade: "" }
    ),
  };

  // Удалять заявку совсем может только администратор, и только «чистую»:
  // без отгрузок, без денег, без рекламаций. Правило то же, что проверит
  // сервер (src/lib/orderDelete.ts), и считается по ПОЛНОЙ заявке.
  const canDelete = canDeleteOrder({
    order: loaded,
    role,
    shipments: allShipments.filter((s) => s.orderId === loaded.orderId).length,
    claims: allClaims.filter((c) => c.orderId === loaded.orderId).length,
    shippedStatus: ORDER_STATUSES.SHIPPED,
  });
  // Направление отгрузки менеджер ставит и правит сам (решение владельца:
  // «пусть менеджер сам заявку по Киргизии делает, без РОПа»). Правило то же,
  // что проверит сервер, и считается по ПОЛНОЙ заявке: зав. складом видит её
  // урезанной до своего цветка, и трогать направление оттуда незачем.
  const canSetOrderDirection =
    !farm &&
    directionEditRefusal({
      role,
      actorEmail: myEmail,
      orderManagerEmail: loaded.managerEmail,
      direction: loaded.direction,
      isShop: Boolean((loaded.retail || "").trim()),
      isRegion: region,
    }) === "";
  // Пока направления нет, подставляем угаданное по городу клиента — как в
  // списке РОПа: предложенное уже выбрано, и нажатие ровно одно. Записывать оно
  // ничего не записывает, человек видит его до сохранения.
  const suggestedDirection = directionForCity(client?.city);
  const directionHint = client?.city ? `Город клиента — ${client.city}` : "";

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">Заявка {order.orderId}</h1>
        <div className="flex items-center gap-3">
          {canEdit && (
            <Link href={`/orders/${order.orderId}/edit`} className="btn-secondary !py-1">
              Изменить
            </Link>
          )}
          <OrderStageBadge stage={stage} />
        </div>
      </div>
      {canEdit && !order.deliveryDate && (
        <div className="text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2 mb-3">
          Нет даты доставки — склад не увидит заявку.{" "}
          <Link href={`/orders/${order.orderId}/edit`} className="underline">
            Указать дату
          </Link>
        </div>
      )}
      <p className="text-sm text-ink-muted mb-6">
        {retail && (
          <>
            <span className="text-ink-secondary">{retailLabel(order.retail)} · наш магазин</span>
            {" · "}
          </>
        )}
        Создана {formatMoment(order.createdAt)} · менеджер {personName(order.managerEmail, managerNames)}
        {farm && (
          <>
            {" · "}
            <span className="text-ink-secondary">
              показаны только позиции {farmLabel(farm)}
            </span>
          </>
        )}
      </p>

      {/* Где заявка и чей ход — одной строкой над всем остальным. Раньше
          статус «Новая» стоял у каждой заявки, а что мешает её собрать и от
          кого это зависит, приходилось собирать из трёх блоков ниже. */}
      {stage.actor && (
        <div
          className={
            "card !py-3 mb-4 flex flex-wrap items-center justify-between gap-3 " +
            (stage.lateDays > 0 ? "border-status-critical/40" : "")
          }
        >
          <div className="text-sm">
            <div className="font-medium">{stage.next}</div>
            {stage.lateDays > 0 && (
              <div className="text-status-critical mt-0.5">
                Доставка была {formatDay(order.deliveryDate)} — {stage.lateDays} дн. назад, а заявка не отгружена
              </div>
            )}
          </div>
          {canShip && (
            <Link href={`/warehouse/ship/${order.orderId}`} className="btn-primary">
              Отгрузить
            </Link>
          )}
        </div>
      )}

      <ReadyChecks
        orderId={order.orderId}
        managerConfirmed={order.managerConfirmed}
        paid={order.paid}
        paidAt={order.paidAt}
        paymentMethod={order.paymentMethod}
        paidAmount={order.paidAmount}
        totalAmount={order.totalAmount}
        retail={order.retail}
        kind={order.kind}
        consignment={isConsignment(order)}
        creditTerms={isCreditTerms(order.clientPaymentTerms) ? order.clientPaymentTerms : ""}
        invoiceSentAt={order.invoiceSentAt}
        canConfirm={
          role === "admin" ||
          (((role === "manager" && !region) ||
            isRetailRole(role) ||
            (retail && canFillRegions(role)) ||
            (region && canFillRegionOrders(role))) &&
            order.managerEmail === myEmail)
        }
      />

      {shipBlockedReason && (
        <div className="card mb-6 text-sm text-ink-secondary">
          <span className="font-medium text-ink-primary">Отгрузка закрыта:</span>{" "}
          {shipBlockedReason}
        </div>
      )}

      <div className="card grid sm:grid-cols-2 gap-4 mb-6">
        {/* У городской заявки контрагента нет по замыслу: показывать «Клиент —
            Астана» значило бы выдумать клиента, которого не существует. */}
        {region ? (
          <div>
            <div className="label">Регион</div>
            <div className="font-medium">{order.direction || "—"}</div>
          </div>
        ) : (
          <>
            <div>
              <div className="label">Клиент</div>
              <div>
                {order.clientId ? (
                  <Link href={`/clients/${order.clientId}`} className="hover:underline">
                    {order.clientName}
                  </Link>
                ) : (
                  order.clientName
                )}
              </div>
            </div>
            <div>
              <div className="label">Телефон</div>
              <div>{order.clientPhone || "—"}</div>
            </div>
          </>
        )}
        <div>
          <div className="label">Дата доставки</div>
          <div>{formatDay(order.deliveryDate)}</div>
        </div>
        {!region && (order.direction || canSetOrderDirection) && (
          <OrderDirection
            orderId={order.orderId}
            direction={order.direction}
            editable={canSetOrderDirection}
            suggested={suggestedDirection}
            hint={directionHint}
          />
        )}
        {!region && (
          <div>
            <div className="label">Комментарий</div>
            <div>{order.notes || "—"}</div>
          </div>
        )}
      </div>

      <div className="card !p-0 table-scroll table-cards mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Позиция</th>
              <th className="px-4 py-3 font-medium">Заказано</th>
              <th className="px-4 py-3 font-medium">Отгружено</th>
              {/* У городской заявки цены нет по замыслу — две колонки нулей
                  только заставляли бы гадать, не забыли ли их заполнить. */}
              {!region && <th className="px-4 py-3 font-medium">Цена</th>}
              {!region && <th className="px-4 py-3 font-medium">Сумма</th>}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.itemId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-3 font-medium">
                  {FLOWER_TYPE_LABELS[item.flowerType]} {item.variety} · {formatGrade(item.grade)}
                </td>
                <td className="px-4 py-3 tabular-nums" data-label="Заказано">{item.quantity.toLocaleString("ru-RU")}</td>
                <td className="px-4 py-3 tabular-nums" data-label="Отгружено">
                  {item.shippedQuantity.toLocaleString("ru-RU")} / {item.quantity.toLocaleString("ru-RU")}
                </td>
                {!region && (
                  <td className="px-4 py-3 tabular-nums" data-label="Цена">{item.unitPrice.toLocaleString("ru-RU")} ₸</td>
                )}
                {!region && (
                  <td className="px-4 py-3 font-medium tabular-nums" data-label="Сумма">
                    {(item.quantity * item.unitPrice).toLocaleString("ru-RU")} ₸
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={region ? 1 : 4} className="px-4 py-3 text-right text-ink-secondary">
                Итого
              </td>
              {region ? (
                <td colSpan={2} className="px-4 py-3 font-semibold">
                  {order.items.reduce((s, i) => s + i.quantity, 0).toLocaleString("ru-RU")} шт.
                </td>
              ) : (
                <td className="px-4 py-3 font-semibold">
                  {order.totalAmount.toLocaleString("ru-RU")} ₸
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      {!region && invoice.length > 0 && (
        <div className="card mb-6">
          <div className="text-sm font-medium mb-2">
            {invoice.length > 1 ? "Счета по компаниям" : "Счёт"}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {invoice.map((f) => {
              const left = Math.max(0, f.amount - f.paidAmount);
              return (
                <div key={f.farm}>
                  <div className="label">{f.farmLabel}</div>
                  <div className="font-medium tabular-nums">
                    {Math.round(f.amount).toLocaleString("ru-RU")} ₸
                  </div>
                  <div
                    className={
                      left <= 1
                        ? "text-xs text-status-good"
                        : f.paidAmount > 0
                          ? "text-xs text-[#8a5a00]"
                          : "text-xs text-ink-muted"
                    }
                  >
                    {left <= 1
                      ? "оплачено"
                      : f.paidAmount > 0
                        ? `получено ${Math.round(f.paidAmount).toLocaleString("ru-RU")} ₸ · остаток ${Math.round(left).toLocaleString("ru-RU")} ₸`
                        : "не оплачено"}
                  </div>
                </div>
              );
            })}
          </div>
          {(kaspiOfClient.length > 0 || order.paymentMethod) && (
            <p className="text-xs text-ink-muted mt-2">
              {order.paymentMethod && `Оплата: ${order.paymentMethod}.`}
              {kaspiOfClient.length > 0 && ` Kaspi клиента: ${kaspiOfClient.join(" / ")}.`}
            </p>
          )}
          {/* Реализации 1С — по одной на цветок: розу и эустому продаёт одна
              компания, но в 1С это два документа, и у каждого своя сумма
              (просьба бухгалтера). У заявки из одного цветка — одна строка. */}
          {(() => {
            const list = realizationsOf(loaded.items, loaded.realization1c);
            if (list.length < 2 && !loaded.realization1c) return null;
            return (
              <div className="mt-3 text-sm">
                <div className="label">{list.length > 1 ? "Реализации в 1С" : "Реализация в 1С"}</div>
                <ul className="space-y-0.5">
                  {list.map((r) => (
                    <li key={r.flowerType} className="tabular-nums">
                      <span className="capitalize">{r.label}</span> — {Math.round(r.amount).toLocaleString("ru-RU")} ₸
                      <span className="text-ink-muted"> · № {r.number || "не вписан"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {/* Какими частями платил клиент — видно всем, кто видит счёт. */}
          {!canTakeMoney && orderPayments.length > 0 && (
            <div className="mt-3 text-sm">
              <div className="label">Платежи</div>
              <ul className="space-y-0.5">
                {paymentHistory(loaded.paidAmount, orderPayments).rows.map((p) => (
                  <li key={p.paymentId} className="tabular-nums">
                    {Math.round(p.amount).toLocaleString("ru-RU")} ₸
                    <span className="text-ink-muted">
                      {" "}
                      · {formatDay(p.date)} · {p.method}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {canTakeMoney && (
        <div className="card mb-6">
          <div className="text-sm font-medium mb-3">Оплата</div>
          <PaymentPanel
            orderId={loaded.orderId}
            totalAmount={loaded.totalAmount}
            paidAmount={loaded.paidAmount}
            farms={farmPayments(loaded)}
            invoiceSentAt={loaded.invoiceSentAt}
            payments={orderPayments}
            realizations={realizationsOf(loaded.items, loaded.realization1c)}
            defaultMethod={loaded.paymentMethod}
            status={loaded.status}
            consignment={isConsignment(loaded)}
          />
        </div>
      )}

      {region && (
        <RegionIncomePanel
          orderId={order.orderId}
          direction={order.direction || "—"}
          stems={order.items.reduce((s, i) => s + i.quantity, 0)}
          income={order.paidAmount}
          canEdit={role === ROLES.ACCOUNTANT || role === ROLES.ADMIN}
        />
      )}

      {/* У городской заявки клиента нет, значит и рекламации от него не бывает:
          пересчитывать нечего — счёта тоже нет. */}
      {!region && (
        <OrderClaims orderId={order.orderId} claims={claims} canCreate={canCreateClaim} />
      )}

      {/* Зав. складом правит СВОИ позиции: заказали шестидесятку, а в
          холодильнике пятидесятка. Всё остальное — чужой цветок, сорт, состав —
          остаётся за менеджером (src/lib/warehouseOrderEdit.ts). */}
      {canWarehouseAdjust && (
        <WarehouseItemsEdit
          orderId={order.orderId}
          items={warehouseItems}
          otherItemsTotal={otherItemsTotal}
          paidAmount={loaded.paidAmount}
          totalBefore={loaded.totalAmount}
          region={region}
          farm={farm ?? ""}
          save={adjustOrderByWarehouseAction}
        />
      )}

      {/* Показывается и без прав: после возврата, отменившего заявку, прав уже
          нет, а итог (и ссылку на заявку магазину) человек увидеть должен. Без
          сделанного в этот раз возврата компонент ничего не рисует. */}
      {(returnRights.refusal === "" || returnRights.refusal === RETURN_CANCELLED) && (
        <ReturnItems
          order={returnOrder}
          access={returnRights}
          shops={returnShops}
          showMoney={!farm && !retail && !region}
          save={returnOrderItemsAction}
        />
      )}

      <h2 className="font-medium mb-2">История отгрузок</h2>
      <div className="card !p-0 table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Партия</th>
              <th className="px-4 py-3 font-medium">Кол-во</th>
              <th className="px-4 py-3 font-medium">Кладовщик</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.shipmentId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-3">{formatMoment(s.createdAt)}</td>
                <td className="px-4 py-3">{s.batchId}</td>
                <td className="px-4 py-3">
                  {s.quantity < 0 ? <span className="text-[#8a5a00]">возврат {-s.quantity}</span> : s.quantity}
                </td>
                <td className="px-4 py-3 text-ink-secondary">{s.warehouseEmail ? personName(s.warehouseEmail, managerNames) : (s.notes ? "восстановлено" : "—")}</td>
              </tr>
            ))}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  Отгрузок ещё не было
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(canCancel || canDelete) && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          {canCancel && <CancelOrder orderId={order.orderId} />}
          {canDelete && <DeleteOrder orderId={order.orderId} />}
        </div>
      )}

    </div>
  );
}
