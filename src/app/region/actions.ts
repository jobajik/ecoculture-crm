"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ORDER_KINDS, ORDER_STATUSES, ROLES } from "@/lib/constants";
import { isRegionStore, normalizeStore, regionStoreInfo, type StoreCode } from "@/lib/officeStore";
import {
  regionAccess,
  retailCardsOf,
  setRegionDirector,
  splitTruckLines,
  truckCancelRefusal,
  truckKindOf,
  truckOrderRefusal,
  type ReceiptLineInput,
  type TruckLineInput,
} from "@/lib/regionTruck";
import { commitTruckReceipt } from "@/lib/repo/regionTruck";
import { updateManagerProfiles } from "@/lib/repo/regionStore";
import { buildNewOrder, getOrderById, updateOrderNotes, updateOrderStatus, type NewOrderInput } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listUsers, saveUser } from "@/lib/repo/users";
import { cleanStaff, staffSaveRefusal, type StaffDraft } from "@/lib/staffRules";
import { PRICE_KINDS, priceFor } from "@/lib/priceList";
import { commitAtomic, forgetReads, SHEET_TABS } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { orderCode } from "@/lib/paymentStage";
import { notifyWarehouseOfTruckOrder } from "@/lib/truckNotify";
import { siteOrigin } from "@/lib/waybillKick";

/**
 * Действия раздела «Регион» (17.11.2026, правила — `src/lib/regionTruck.ts`): заказ на фуру, его отмена, приёмка фуры и
 * назначение директора города. Права — по посадке в город (`regionAccess`), а не по роли: директор — тот же менеджер.
 */
async function actorFor(storeRaw: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const store = normalizeStore(storeRaw);
  const info = regionStoreInfo(store);
  if (!isRegionStore(store) || !info) throw new Error("Город не из списка регионов");
  const access = regionAccess({ role: session.user.role, store: session.user.store, director: session.user.director }, store);
  if (!access.view) throw new Error("Это не ваш регион");
  return { email: session.user.email.toLowerCase(), role: session.user.role ?? "", store: store as StoreCode, info, access };
}

function touch(store: string) {
  revalidatePath("/warehouse/trucks");
  revalidatePath("/region", "layout");
  revalidatePath(`/region/${store}`);
  revalidatePath("/orders");
  revalidatePath("/warehouse");
  revalidatePath("/retail");
  revalidatePath("/plans/regions");
}

/**
 * Заказ на фуру. Одна форма — до двух заявок, привычных складу: «объём на город» (опт, без цен) и заявка в карточку
 * розницы города (в магазины, по внутреннему прайсу). Обе подтверждены сразу и пишутся ОДНОЙ атомарной записью: половина
 * заказа — опт уехал в очередь склада, а магазины нет — хуже отказа.
 */
async function createTruckOrderActionInner(input: { store: string; deliveryDate: string; lines: TruckLineInput[]; note?: string }) {
  const me = await actorFor(input.store);
  const lines: TruckLineInput[] = (input.lines ?? []).map((l) => ({
    flowerType: String(l.flowerType || ""),
    variety: String(l.variety || "").trim(),
    grade: String(l.grade || ""),
    wholesale: Number(l.wholesale) || 0,
    retail: Number(l.retail) || 0,
  }));
  const cards = retailCardsOf(await listClients(), me.store).filter((c) => c.active);
  const refusal = truckOrderRefusal({ access: me.access, deliveryDate: input.deliveryDate, today: localDayKey(), lines, hasRetailCard: cards.length > 0 });
  if (refusal) throw new Error(refusal);

  const split = splitTruckLines(lines);
  const note = String(input.note ?? "").trim().slice(0, 300);
  const notes = `Заказ на фуру от региона ${me.info.label}.${note ? ` ${note}` : ""}`;
  const built: ReturnType<typeof buildNewOrder>[] = [];
  if (split.wholesale.length > 0) {
    built.push(
      buildNewOrder({
        kind: ORDER_KINDS.REGION,
        direction: me.info.label,
        clientId: "",
        clientName: me.info.label,
        clientPhone: "",
        deliveryDate: input.deliveryDate,
        notes,
        confirmed: true,
        items: split.wholesale.map((i) => ({ ...i, flowerType: i.flowerType as NewOrderInput["items"][number]["flowerType"], unitPrice: 0 })),
        managerEmail: me.email,
      })
    );
  }
  if (split.retail.length > 0) {
    const card = cards[0];
    // Цена — внутренний прайс розницы, как в форме «Заявка в магазин». Нет цены — ноль: заказ не блокируем, сумму увидят
    // в «Рознице» и поправят прайс.
    const prices = await getCurrentPrices(undefined, PRICE_KINDS.RETAIL);
    built.push(
      buildNewOrder({
        clientId: card.clientId,
        clientName: card.name,
        clientPhone: card.phone || "",
        retail: card.retail,
        deliveryDate: input.deliveryDate,
        notes,
        confirmed: true,
        items: split.retail.map((i) => ({
          ...i,
          flowerType: i.flowerType as NewOrderInput["items"][number]["flowerType"],
          unitPrice: priceFor(prices, i.flowerType, i.variety, i.grade),
        })),
        managerEmail: me.email,
      })
    );
  }
  await commitAtomic([
    { kind: "append", tab: SHEET_TABS.ORDERS, records: built.map((b) => b.orderRecord) },
    { kind: "append", tab: SHEET_TABS.ORDER_ITEMS, records: built.flatMap((b) => b.itemRecords) },
  ]);
  touch(me.store);
  revalidatePath("/warehouse/trucks");
  // Склад узнаёт о заказе сразу — сообщением в WhatsApp (номер из карточки сотрудника). Не ушло — заказ всё равно лежит
  // на экране «Фуры в регионы».
  const byName = (await listUsers().catch(() => [])).find((u) => u.email.toLowerCase() === me.email)?.name ?? "";
  await notifyWarehouseOfTruckOrder({
    city: me.info.label,
    day: input.deliveryDate,
    byName: byName.split(/\s+/)[0] ?? "",
    items: [...split.wholesale, ...split.retail].map((i) => ({ flowerType: i.flowerType, quantity: i.quantity })),
    origin: siteOrigin(),
  });
  return { orders: built.map((b) => orderCode(b.orderId)) };
}

/** Отмена заказа на фуру — пока склад ничего по нему не отгрузил. */
async function cancelTruckOrderActionInner(storeRaw: string, orderId: string) {
  const me = await actorFor(storeRaw);
  forgetReads(); // «ничего не отгружено» проверяем по свежим данным
  const [order, clients] = await Promise.all([getOrderById(String(orderId || "")), listClients()]);
  const kind = order ? truckKindOf(order, me.store, new Set(retailCardsOf(clients, me.store).map((c) => c.clientId))) : null;
  const refusal = truckCancelRefusal({ access: me.access, order, kind });
  if (refusal) throw new Error(refusal);
  await updateOrderStatus(order!.orderId, ORDER_STATUSES.CANCELLED);
  const stamp = `Отменён ${localDayKey().slice(8, 10)}.${localDayKey().slice(5, 7)} (${me.email}).`;
  await updateOrderNotes(order!.orderId, order!.notes ? `${order!.notes} ${stamp}` : stamp);
  touch(me.store);
}

/** Приёмка фуры: сколько приехало по каждой позиции; принятый опт ложится на склад города. */
async function acceptTruckActionInner(input: { store: string; orderId: string; lines: ReceiptLineInput[]; note?: string }) {
  const me = await actorFor(input.store);
  const plan = await commitTruckReceipt({
    orderId: String(input.orderId || ""),
    store: me.store,
    access: me.access,
    byEmail: me.email,
    lines: (input.lines ?? []).map((l) => ({ itemId: String(l.itemId || ""), shipped: Number(l.shipped), accepted: Number(l.accepted) })),
    note: String(input.note ?? ""),
  });
  touch(me.store);
  return { accepted: plan.accepted, shortage: plan.shortage, landed: plan.kind === "wholesale" };
}

/** Назначить (или снять) директора города и день фуры — администратор, в «Настройках». */
async function setRegionDirectorActionInner(input: { store: string; email: string; weekday: number; female?: boolean }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== ROLES.ADMIN) throw new Error("Менеджеров городов назначает администратор");
  const store = normalizeStore(input.store);
  if (!isRegionStore(store)) throw new Error("Город не из списка регионов");
  const email = String(input.email || "").trim().toLowerCase();
  if (email) {
    // Почта — из списка сотрудников, а не из браузера (грабли 1.11): директор — действующий менеджер.
    const user = (await listUsers()).find((u) => u.email.toLowerCase() === email);
    if (!user || !user.active || user.role !== ROLES.MANAGER) throw new Error("Менеджером города можно назначить действующего сотрудника с ролью «Менеджер»");
  }
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Выберите день недели, когда уходит фура");
  await updateManagerProfiles((raw) => {
    const next = setRegionDirector(raw, { store, email, weekday });
    if (email) {
      const key = Object.keys(next).find((k) => k.trim().toLowerCase() === email)!;
      next[key] = { ...next[key], female: input.female === true };
    }
    return next;
  });
  revalidatePath("/admin");
  touch(store);
}

/**
 * Завести менеджера города одним шагом (22.11.2026, владелец: «завести 4 менеджеров (номеров) по этим городам»):
 * сотрудник с ролью «Менеджер» (имя, почта Google, номер WhatsApp) и сразу посадка в город. Те же запреты, что у
 * «Сотрудников» (`staffSaveRefusal`) и у назначения (`setRegionDirector`). Существующего сотрудника сюда не вписывают —
 * его выбирают из списка: иначе по опечатке в почте чужому человеку сменили бы роль.
 */
async function addCityManagerActionInner(input: { store: string; name: string; email: string; phone: string; weekday: number; female?: boolean }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== ROLES.ADMIN) throw new Error("Менеджеров городов заводит администратор");
  const store = normalizeStore(input.store);
  const info = regionStoreInfo(store);
  if (!isRegionStore(store) || !info) throw new Error("Город не из списка регионов");
  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Выберите день недели, когда уходит фура");
  const draft: StaffDraft = { email: String(input.email || ""), name: String(input.name || ""), role: ROLES.MANAGER, farm: "", active: true, phone: String(input.phone || "") };
  if (!draft.name.trim()) throw new Error("Впишите имя менеджера");
  const users = await listUsers();
  const clean = cleanStaff(draft);
  if (users.some((u) => u.email.toLowerCase() === clean.email.toLowerCase())) throw new Error("Сотрудник с такой почтой уже есть — выберите его в списке «Менеджер города»");
  const refusal = staffSaveRefusal({ actorRole: session.user.role, actorEmail: session.user.email, users }, draft);
  if (refusal) throw new Error(refusal);
  await saveUser(clean);
  const email = clean.email.toLowerCase();
  await updateManagerProfiles((raw) => {
    const next = setRegionDirector(raw, { store, email, weekday });
    const key = Object.keys(next).find((k) => k.trim().toLowerCase() === email)!;
    next[key] = { ...next[key], female: input.female === true };
    return next;
  });
  revalidatePath("/admin");
  revalidatePath("/orders");
  touch(store);
  return { name: clean.name, city: info.label };
}

export async function addCityManagerAction(...args: Parameters<typeof addCityManagerActionInner>) {
  return guard(() => addCityManagerActionInner(...args));
}

export async function createTruckOrderAction(...args: Parameters<typeof createTruckOrderActionInner>) {
  return guard(() => createTruckOrderActionInner(...args));
}

export async function cancelTruckOrderAction(...args: Parameters<typeof cancelTruckOrderActionInner>) {
  return guard(() => cancelTruckOrderActionInner(...args));
}

export async function acceptTruckAction(...args: Parameters<typeof acceptTruckActionInner>) {
  return guard(() => acceptTruckActionInner(...args));
}

export async function setRegionDirectorAction(...args: Parameters<typeof setRegionDirectorActionInner>) {
  return guard(() => setRegionDirectorActionInner(...args));
}
