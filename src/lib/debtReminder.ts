/**
 * Напоминания о долгах в WhatsApp (сентябрь 2026, владелец: «когда у клиента
 * заканчивается отсрочка, CRM сама вежливо пишет в WhatsApp и прикладывает
 * счёт Kaspi; бухгалтеру остаются только те, кто не заплатил после
 * напоминания»). Решения владельца: отправляет БУХГАЛТЕР одной кнопкой (список
 * «кому напомнить сегодня» с готовым текстом), счёт Kaspi — где касса
 * подключена (сейчас Есентай, хризантема), по розе и эустоме — только текст.
 *
 * Здесь — чистые правила: кому пора, что написать. Отправка —
 * `debtReminderRunner.ts`, страница — «Оплаты → Напоминания».
 */
import { MONEY_EPSILON, ORDER_STATUSES } from "./constants";
import { isNotASale } from "./orderKind";
import { farmPayments } from "./orderMoney";
import { orderCode } from "./paymentStage";
import { isOpenKaspiStatus, kaspiDueAmount, prettyKaspiPhone, suggestedKaspiPhone } from "./kaspiInvoice";
import { greetingName, waPhone } from "./broadcast";
import { phoneKey } from "./leads";
import type { OrderWithItems } from "./types";

/** Второй раз по той же заявке — не раньше чем через столько дней. */
export const REMIND_GAP_DAYS = 3;
/** Пауза между сообщениями при отправке списком — как у рассылки, чтобы номер не приняли за робота. */
export const SEND_GAP_SECONDS: [number, number] = [20, 40];

export interface ReminderClient {
  clientId: string;
  name: string;
  contactPerson?: string;
  phone: string;
  kaspiPay1?: string;
  kaspiPay2?: string;
  managerEmail?: string;
}

export interface ReminderRecord {
  reminderId: string;
  sentAt: string;
  phone: string;
  clientName: string;
  orderIds: string[];
  amount: number;
  messageId: string;
  kaspiInvoices: string;
  sentByEmail: string;
  error: string;
}

export interface ReminderInvoice {
  orderId: string;
  farm: string;
  status: string;
  amount: number;
}

type ReminderOrder = Pick<
  OrderWithItems,
  | "orderId"
  | "clientId"
  | "clientName"
  | "clientPhone"
  | "status"
  | "deliveryDate"
  | "createdAt"
  | "items"
  | "paidAmount"
  | "paidRoseFarm"
  | "paidEsentai"
  | "totalAmount"
  | "promisedAt"
  | "retail"
  | "kind"
  | "direction"
> & { clientPaymentTerms?: string; managerEmail?: string };

/** «Отсрочка 7 дней» → 7; «По факту», «Предоплата», пусто → 0. */
export function termDays(terms: string | null | undefined): number {
  const m = String(terms || "").match(/отсрочк\D*(\d{1,3})/i);
  return m ? Number(m[1]) : 0;
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
}

/**
 * Когда пора платить: доставка (нет её — день оформления) плюс отсрочка из
 * карточки клиента. Та же база, что у долгов (`finance.ts`).
 */
export function dueDateOf(order: Pick<ReminderOrder, "deliveryDate" | "createdAt" | "clientPaymentTerms">): string {
  const basis = order.deliveryDate || (order.createdAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(basis)) return "";
  return addDays(basis, termDays(order.clientPaymentTerms));
}

const orderDebt = (o: ReminderOrder) => {
  const rest = o.totalAmount - o.paidAmount;
  return rest > MONEY_EPSILON ? rest : 0;
};

export interface ReminderOrderLine {
  orderId: string;
  code: string;
  /** День доставки (или оформления) — по нему клиент узнаёт заказ. */
  day: string;
  debt: number;
  dueDate: string;
  daysLate: number;
}

export interface KaspiPart {
  orderId: string;
  farm: string;
  amount: number;
}

export interface ReminderGroup {
  key: string;
  clientName: string;
  greeting: string;
  managerEmail: string;
  /** Куда писать в WhatsApp; пусто — отправить нельзя (см. `problem`). */
  waPhone: string;
  /** На какой номер выставлять счёт Kaspi. */
  kaspiPhone: string;
  orders: ReminderOrderLine[];
  total: number;
  /** Счета Kaspi, которые будут выставлены при отправке. */
  kaspiNew: KaspiPart[];
  /** Уже выставленные и ждущие оплаты — про них напомним словами. */
  kaspiOpen: KaspiPart[];
  lastRemindedAt: string;
  problem: string;
}

export interface ReminderPlan {
  due: ReminderGroup[];
  /** Сколько клиентов пропущено, потому что им уже напоминали за последние дни. */
  recentlyReminded: number;
  /** Сколько — потому что обещали заплатить позже. */
  promised: number;
}

/**
 * Кому напомнить сегодня. По каждой заявке: долг есть, это продажа (не наш
 * магазин, не город, не точка на базаре), срок оплаты наступил, клиент не
 * обещал заплатить позже и по заявке не напоминали `REMIND_GAP_DAYS` дней.
 * Заявки одного клиента — одним сообщением.
 */
export function planReminders(input: {
  orders: ReminderOrder[];
  clients: ReminderClient[];
  reminders: ReminderRecord[];
  invoices: ReminderInvoice[];
  kaspiFarms: string[];
  today: string;
}): ReminderPlan {
  const { today } = input;
  const clientById = new Map(input.clients.map((c) => [c.clientId, c]));
  const lastByOrder = new Map<string, string>();
  for (const r of input.reminders) {
    if (r.error && !r.messageId) continue; // не ушло — не считается напоминанием
    for (const id of r.orderIds) {
      const prev = lastByOrder.get(id) ?? "";
      if (r.sentAt > prev) lastByOrder.set(id, r.sentAt);
    }
  }
  const gapEdge = addDays(today, -REMIND_GAP_DAYS + 1);

  const groups = new Map<string, ReminderGroup>();
  const skippedRecent = new Set<string>();
  const skippedPromised = new Set<string>();

  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || isNotASale(o)) continue;
    const debt = orderDebt(o);
    if (debt <= 0) continue;
    const dueDate = dueDateOf(o);
    if (!dueDate || dueDate > today) continue;
    const client = o.clientId ? clientById.get(o.clientId) : undefined;
    const key = o.clientId || phoneKey(o.clientPhone) || o.orderId;
    if (o.promisedAt && o.promisedAt >= today) {
      skippedPromised.add(key);
      continue;
    }
    const last = lastByOrder.get(o.orderId) ?? "";
    if (last && last.slice(0, 10) >= gapEdge) {
      skippedRecent.add(key);
      continue;
    }

    const g =
      groups.get(key) ??
      ({
        key,
        clientName: client?.name || o.clientName || "(без названия)",
        greeting: greetingName(client?.contactPerson ?? "", client?.name || o.clientName),
        managerEmail: (client?.managerEmail || o.managerEmail || "").toLowerCase(),
        waPhone: [o.clientPhone, client?.phone, client?.kaspiPay1, client?.kaspiPay2].map(waPhone).find(Boolean) ?? "",
        kaspiPhone: suggestedKaspiPhone([client?.kaspiPay1, client?.kaspiPay2, o.clientPhone, client?.phone]),
        orders: [],
        total: 0,
        kaspiNew: [],
        kaspiOpen: [],
        lastRemindedAt: "",
        problem: "",
      } satisfies ReminderGroup);

    g.orders.push({
      orderId: o.orderId,
      code: orderCode(o.orderId),
      day: o.deliveryDate || (o.createdAt || "").slice(0, 10),
      debt,
      dueDate,
      daysLate: Math.max(0, daysBetween(dueDate, today)),
    });
    g.total += debt;
    if (last > g.lastRemindedAt) g.lastRemindedAt = last;

    for (const part of farmPayments(o)) {
      const due = kaspiDueAmount(part);
      if (due <= 0 || !input.kaspiFarms.includes(part.farm)) continue;
      const open = input.invoices.find((i) => i.orderId === o.orderId && i.farm === part.farm && isOpenKaspiStatus(i.status));
      if (open) g.kaspiOpen.push({ orderId: o.orderId, farm: part.farm, amount: open.amount });
      else g.kaspiNew.push({ orderId: o.orderId, farm: part.farm, amount: due });
    }
    groups.set(key, g);
  }

  const due = Array.from(groups.values()).map((g) => {
    g.orders.sort((a, b) => (a.day < b.day ? -1 : 1));
    if (!g.waPhone) g.problem = "нет мобильного номера — позвоните";
    // Счёт Kaspi без номера для Kaspi не выставить — останется текстом.
    if (!g.kaspiPhone) g.kaspiNew = [];
    return g;
  });
  // Сначала те, кому можно написать, внутри — самые давние; без номера — в конце.
  due.sort((a, b) => Number(!!a.problem) - Number(!!b.problem) || Math.max(...b.orders.map((x) => x.daysLate)) - Math.max(...a.orders.map((x) => x.daysLate)) || b.total - a.total);

  for (const g of due) {
    skippedRecent.delete(g.key);
    skippedPromised.delete(g.key);
  }
  return { due, recentlyReminded: skippedRecent.size, promised: skippedPromised.size };
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/** «77015552030» → «+7 701 555 20 30». */
export function prettyWaPhone(p: string): string {
  const d = (p || "").replace(/\D/g, "");
  return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : d ? `+${d}` : "";
}
const dm = (key: string) => (key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : "");

/**
 * Текст напоминания. `kaspiSent` — счета, которые на самом деле выставились
 * (при предпросмотре — все запланированные), плюс уже висящие в Kaspi.
 */
export function reminderText(
  g: Pick<ReminderGroup, "greeting" | "orders" | "total" | "kaspiPhone">,
  kaspi: { amount: number }[]
): string {
  const lines = [
    `Здравствуйте${g.greeting ? `, ${g.greeting}` : ""}!`,
    "Напоминаем об оплате за цветы от Eco Culture:",
    ...g.orders.map((o) => `• заказ от ${dm(o.day)} (№ ${o.code}) — ${money(o.debt)}`),
  ];
  if (g.orders.length > 1) lines.push(`Итого: ${money(g.total)}`);
  const inKaspi = kaspi.reduce((s, k) => s + k.amount, 0);
  if (inKaspi > 0) {
    lines.push("");
    lines.push(
      `Счёт Kaspi на ${money(inKaspi)} выставлен на номер ${prettyKaspiPhone(g.kaspiPhone)} — его можно оплатить в приложении Kaspi.` +
        (inKaspi + 1 < g.total ? " Остальное — удобным вам способом." : "")
    );
  }
  lines.push("");
  lines.push("Если уже оплатили — пожалуйста, не обращайте внимания и напишите нам, мы сверим. Спасибо!");
  return lines.join("\n");
}
