import { listOrdersWithItems } from "./repo/orders";
import { listBatches } from "./repo/batches";
import { listShipments } from "./repo/shipments";
import { listWriteoffs } from "./repo/writeoffs";
import { listPriceHistory } from "./repo/priceHistory";
import { listUsers } from "./repo/users";
import { currentPrices, priceFor, type PriceRow } from "./priceList";
import { toIsoDate } from "./sheetDate";
import {
  FLOWER_TYPE_LABELS,
  ORDER_STATUSES,
  compareGrades,
  formatGrade,
  periodLabel,
} from "./constants";
import type { OrderWithItems } from "./types";
import { isRetailOrder } from "./retail";

// ---------------------------------------------------------------------------
// Календарь месяца: что срезали, что продали, что отгрузили и сколько денег
// пришло — по дням.
//
// Отчёт и календарь отвечают на разные вопросы. Отчёт говорит «за тридцать дней
// продали столько-то», календарь — «а что было во вторник». Второй вопрос
// задают, когда что-то пошло не так: почему в среду ничего не отгрузили, куда
// делся большой срез, кто вытянул субботу. Ради этого в календаре и лежат
// ПОДРОБНОСТИ КАЖДОГО ДНЯ, а не только итоги.
//
// Один важный уговор: деньги отнесены к дате оплаты (PaidAt), а продажи — к
// дате оформления заявки. Это разные дни, и так и должно быть: заявку оформили
// в понедельник, деньги пришли в четверг.
// ---------------------------------------------------------------------------

/** Строка «кто/что» внутри дня: менеджер, цветок, ростовка, склад. */
export interface CalendarLine {
  key: string;
  label: string;
  stems: number;
  amount: number;
  /** Сколько заявок или отгрузок — там, где это осмысленно. */
  count: number;
}

export interface CalendarOrderRow {
  orderId: string;
  clientName: string;
  managerName: string;
  stems: number;
  amount: number;
  paidAmount: number;
  status: string;
}

export interface CalendarPayment {
  orderId: string;
  clientName: string;
  amount: number;
  method: string;
}

export interface CalendarDay {
  /** «ГГГГ-ММ-ДД». */
  date: string;
  day: number;
  /** 1 — понедельник, 7 — воскресенье. */
  weekday: number;
  isToday: boolean;
  /** День ещё не наступил: пустая клетка там — это норма, а не провал. */
  future: boolean;

  receivedStems: number;
  /** Во что срез оценивается по действующему прайсу. */
  receivedMoney: number;
  soldStems: number;
  soldMoney: number;
  orderCount: number;
  shippedStems: number;
  shipmentCount: number;
  paidMoney: number;
  writeoffStems: number;

  // --- подробности дня ---
  byManager: CalendarLine[];
  orders: CalendarOrderRow[];
  receivedByFlower: CalendarLine[];
  receivedByGrade: CalendarLine[];
  shippedByFlower: CalendarLine[];
  payments: CalendarPayment[];
  writeoffs: { reason: string; stems: number }[];
}

export interface CalendarTotals {
  receivedStems: number;
  receivedMoney: number;
  soldStems: number;
  soldMoney: number;
  orderCount: number;
  shippedStems: number;
  paidMoney: number;
  writeoffStems: number;
  /** Дней месяца, которые уже прошли, — чтобы средние были честными. */
  daysPassed: number;
  workingDays: number;
}

export interface CalendarMonth {
  month: string;
  label: string;
  days: CalendarDay[];
  /** Сколько пустых клеток поставить перед первым числом (месяц начался в среду). */
  leadingBlanks: number;
  totals: CalendarTotals;
  /** Наибольшие значения за месяц — по ним красится «тепло» клеток. */
  max: { received: number; sold: number; shipped: number; paid: number };
  /** Две-три фразы обычным языком: что за месяц вообще произошло. */
  headline: string[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Дата из таблицы в «ГГГГ-ММ-ДД». Мусор превращается в пустую строку. */
function isoOf(raw: string): string {
  const iso = toIsoDate(raw);
  if (iso) return iso;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : dayKey(d);
}

/** Порядок цветков — тот же, что на главной и в отчёте: роза, хризантема, эустома. */
const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];
function flowerRank(flowerType: string): number {
  const i = FLOWER_ORDER.indexOf(flowerType);
  return i === -1 ? FLOWER_ORDER.length : i;
}

function line(
  map: Map<string, CalendarLine>,
  key: string,
  label: string,
  stems: number,
  amount = 0,
  count = 0
) {
  const row = map.get(key) ?? { key, label, stems: 0, amount: 0, count: 0 };
  row.stems += stems;
  row.amount += amount;
  row.count += count;
  map.set(key, row);
}

export function buildCalendarMonth(input: {
  month: string;
  now: Date;
  orders: OrderWithItems[];
  batches: Awaited<ReturnType<typeof listBatches>>;
  shipments: Awaited<ReturnType<typeof listShipments>>;
  writeoffs: Awaited<ReturnType<typeof listWriteoffs>>;
  prices: Map<string, PriceRow>;
  nameByEmail: Map<string, string>;
}): CalendarMonth {
  const { month, now, prices, nameByEmail } = input;
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(year, mon - 1, 1);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const todayKey = dayKey(now);

  const byDate = new Map<string, CalendarDay>();
  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, mon - 1, d);
    const key = dayKey(date);
    const row: CalendarDay = {
      date: key,
      day: d,
      // getDay(): 0 — воскресенье. Неделя у нас начинается с понедельника.
      weekday: ((date.getDay() + 6) % 7) + 1,
      isToday: key === todayKey,
      future: key > todayKey,
      receivedStems: 0,
      receivedMoney: 0,
      soldStems: 0,
      soldMoney: 0,
      orderCount: 0,
      shippedStems: 0,
      shipmentCount: 0,
      paidMoney: 0,
      writeoffStems: 0,
      byManager: [],
      orders: [],
      receivedByFlower: [],
      receivedByGrade: [],
      shippedByFlower: [],
      payments: [],
      writeoffs: [],
    };
    days.push(row);
    byDate.set(key, row);
  }

  // Копилки подробностей: собираем в Map, чтобы не искать строку перебором.
  const managerMaps = new Map<string, Map<string, CalendarLine>>();
  const flowerMaps = new Map<string, Map<string, CalendarLine>>();
  const gradeMaps = new Map<string, Map<string, CalendarLine>>();
  const shipFlowerMaps = new Map<string, Map<string, CalendarLine>>();
  const writeoffMaps = new Map<string, Map<string, number>>();
  const pick = (store: Map<string, Map<string, CalendarLine>>, date: string) => {
    const found = store.get(date);
    if (found) return found;
    const created = new Map<string, CalendarLine>();
    store.set(date, created);
    return created;
  };

  // --- Продажи и деньги ----------------------------------------------------
  for (const order of input.orders) {
    if (order.status === ORDER_STATUSES.CANCELLED) continue;
    // Розница в «продажах и деньгах» дня не участвует: перемещение в наш
    // магазин выручкой не является, а посчиталось бы дважды — сейчас и когда
    // магазин продаст букет покупателю.
    if (isRetailOrder(order)) continue;

    const created = isoOf(order.createdAt);
    const day = byDate.get(created);
    if (day) {
      const stems = order.items.reduce((s, i) => s + i.quantity, 0);
      const amount = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      day.soldStems += stems;
      day.soldMoney += amount;
      day.orderCount += 1;
      day.orders.push({
        orderId: order.orderId,
        clientName: order.clientName || "(без названия)",
        managerName: nameByEmail.get(order.managerEmail) ?? order.managerEmail,
        stems,
        amount,
        paidAmount: order.paidAmount,
        status: order.status,
      });
      line(
        pick(managerMaps, created),
        order.managerEmail,
        nameByEmail.get(order.managerEmail) ?? order.managerEmail,
        stems,
        amount,
        1
      );
    }

    // Деньги считаем на дату ОПЛАТЫ: заявку оформили в понедельник, а деньги
    // пришли в четверг — и в календаре они должны стоять в четверге.
    if (order.paidAmount > 0) {
      const paidDay = byDate.get(isoOf(order.paidAt));
      if (paidDay) {
        paidDay.paidMoney += order.paidAmount;
        paidDay.payments.push({
          orderId: order.orderId,
          clientName: order.clientName || "(без названия)",
          amount: order.paidAmount,
          method: order.paymentMethod,
        });
      }
    }
  }

  // --- Срез (приёмка) ------------------------------------------------------
  for (const batch of input.batches) {
    const date = isoOf(batch.receivedAt || batch.harvestDate);
    const day = byDate.get(date);
    if (!day) continue;
    const money = priceFor(prices, batch.flowerType, batch.variety, batch.grade) * batch.quantityIn;
    day.receivedStems += batch.quantityIn;
    day.receivedMoney += money;
    line(
      pick(flowerMaps, date),
      batch.flowerType,
      FLOWER_TYPE_LABELS[batch.flowerType] ?? batch.flowerType,
      batch.quantityIn,
      money,
      1
    );
    line(
      pick(gradeMaps, date),
      `${batch.flowerType}:${batch.grade}`,
      `${FLOWER_TYPE_LABELS[batch.flowerType] ?? batch.flowerType} ${formatGrade(batch.grade)}`,
      batch.quantityIn,
      money,
      1
    );
  }

  // --- Отгрузки ------------------------------------------------------------
  const batchById = new Map(input.batches.map((b) => [b.batchId, b]));
  for (const shipment of input.shipments) {
    const date = isoOf(shipment.createdAt);
    const day = byDate.get(date);
    if (!day) continue;
    day.shippedStems += shipment.quantity;
    day.shipmentCount += 1;
    const batch = batchById.get(shipment.batchId);
    const flowerType = batch?.flowerType ?? "";
    line(
      pick(shipFlowerMaps, date),
      flowerType || "unknown",
      flowerType ? FLOWER_TYPE_LABELS[flowerType] ?? flowerType : "Партия не найдена",
      shipment.quantity,
      0,
      1
    );
  }

  // --- Списания ------------------------------------------------------------
  for (const writeoff of input.writeoffs) {
    const date = isoOf(writeoff.createdAt);
    const day = byDate.get(date);
    if (!day) continue;
    day.writeoffStems += writeoff.quantity;
    const store = writeoffMaps.get(date) ?? new Map<string, number>();
    const reason = writeoff.reason?.trim() || "Не указана";
    store.set(reason, (store.get(reason) ?? 0) + writeoff.quantity);
    writeoffMaps.set(date, store);
  }

  // --- Раскладываем копилки по дням ---------------------------------------
  for (const day of days) {
    day.byManager = Array.from(managerMaps.get(day.date)?.values() ?? []).sort(
      (a, b) => b.amount - a.amount
    );
    day.orders.sort((a, b) => b.amount - a.amount);
    day.payments.sort((a, b) => b.amount - a.amount);
    // Цветки — в привычном порядке, а не по объёму: три строки, и глаз должен
    // находить розу всегда на одном месте.
    day.receivedByFlower = Array.from(flowerMaps.get(day.date)?.values() ?? []).sort(
      (a, b) => flowerRank(a.key) - flowerRank(b.key)
    );
    // Ростовка идёт в естественном порядке цветка, а не по количеству: это
    // шкала, и «60 см» выше «40 см» просто потому, что её больше, читается плохо.
    day.receivedByGrade = Array.from(gradeMaps.get(day.date)?.values() ?? []).sort((a, b) => {
      const [aType, aGrade] = a.key.split(":");
      const [bType, bGrade] = b.key.split(":");
      return aType === bType
        ? compareGrades(aType, aGrade, bGrade)
        : flowerRank(aType) - flowerRank(bType);
    });
    day.shippedByFlower = Array.from(shipFlowerMaps.get(day.date)?.values() ?? []).sort(
      (a, b) => flowerRank(a.key) - flowerRank(b.key)
    );
    day.writeoffs = Array.from(writeoffMaps.get(day.date)?.entries() ?? [])
      .map(([reason, stems]) => ({ reason, stems }))
      .sort((a, b) => b.stems - a.stems);
  }

  const passed = days.filter((d) => !d.future);
  const totals: CalendarTotals = {
    receivedStems: days.reduce((s, d) => s + d.receivedStems, 0),
    receivedMoney: days.reduce((s, d) => s + d.receivedMoney, 0),
    soldStems: days.reduce((s, d) => s + d.soldStems, 0),
    soldMoney: days.reduce((s, d) => s + d.soldMoney, 0),
    orderCount: days.reduce((s, d) => s + d.orderCount, 0),
    shippedStems: days.reduce((s, d) => s + d.shippedStems, 0),
    paidMoney: days.reduce((s, d) => s + d.paidMoney, 0),
    writeoffStems: days.reduce((s, d) => s + d.writeoffStems, 0),
    daysPassed: passed.length,
    workingDays: passed.filter((d) => d.orderCount > 0).length,
  };

  const max = {
    received: Math.max(0, ...days.map((d) => d.receivedStems)),
    sold: Math.max(0, ...days.map((d) => d.soldMoney)),
    shipped: Math.max(0, ...days.map((d) => d.shippedStems)),
    paid: Math.max(0, ...days.map((d) => d.paidMoney)),
  };

  // --- Коротко -------------------------------------------------------------
  const say = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const money = (n: number) =>
    Math.abs(n) >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн ₸`
      : `${say(n)} ₸`;
  const headline: string[] = [];

  if (totals.orderCount > 0) {
    const best = [...days].sort((a, b) => b.soldMoney - a.soldMoney)[0];
    headline.push(
      `За месяц ${totals.orderCount} заявок на ${money(totals.soldMoney)}. ` +
        `Лучший день — ${best.day} число: ${money(best.soldMoney)}.`
    );
    const idle = passed.filter((d) => d.orderCount === 0).length;
    if (idle > 0) {
      headline.push(
        `Дней без единой заявки: ${idle} из ${totals.daysPassed} прошедших. ` +
          `В рабочий день в среднем ${money(totals.soldMoney / Math.max(1, totals.workingDays))}.`
      );
    }
  } else {
    headline.push("За этот месяц заявок не оформляли.");
  }

  if (totals.receivedStems > 0) {
    headline.push(
      `Срезали и приняли ${say(totals.receivedStems)} стеблей, отгрузили ${say(
        totals.shippedStems
      )}. Оплат пришло на ${money(totals.paidMoney)}.`
    );
  }

  return {
    month,
    label: periodLabel(month),
    days,
    leadingBlanks: (((first.getDay() + 6) % 7) + 7) % 7,
    totals,
    max,
    headline,
  };
}

/** Календарь месяца из таблицы. Только для администратора — фильтров по производству нет. */
export async function getCalendarMonth(month: string, now: Date = new Date()): Promise<CalendarMonth> {
  const [orders, batches, shipments, writeoffs, priceHistory, users] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listShipments(),
    listWriteoffs(),
    listPriceHistory(),
    listUsers(),
  ]);

  const priceRows: PriceRow[] = priceHistory.map((p) => ({
    date: toIsoDate(p.date) || p.date,
    flowerType: p.flowerType,
    variety: p.variety,
    grade: p.grade,
    price: p.price,
  }));

  return buildCalendarMonth({
    month,
    now,
    orders,
    batches,
    shipments,
    writeoffs,
    prices: currentPrices(priceRows, dayKey(now)),
    nameByEmail: new Map(users.map((u) => [u.email, u.name || u.email])),
  });
}
