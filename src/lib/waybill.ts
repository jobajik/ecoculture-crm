import { FARM_LABELS, FARM_ORDER, FLOWER_TYPE_LABELS, ORDER_STATUSES, ROLES, formatGrade, getFarmFor } from "./constants";
import { isNotASale } from "./orderKind";
import { orderCode } from "./paymentStage";
import { canEditFinance } from "./financeAccess";
import { canSellToClients } from "./retail";
import { waPhone } from "./broadcast";
import { phoneKey } from "./leads";

/**
 * Накладная клиенту в WhatsApp после отгрузки (19.11.2026, владелец: «чтобы клиенту бот отправлял накладную, которую
 * ему собрали, с номенклатурой, количеством и суммой; сам придумай форму, картинкой или pdf»; его решения: сразу после
 * отгрузки — на то, что реально отгрузили; отгрузили частями — накладная на каждую часть).
 *
 * Здесь только правила, без таблицы и без отправки (их — `repo/waybills.ts`, `waybillRunner.ts`, картинку рисует
 * `waybillImage.tsx`). Накладная — это СНИМОК: позиции, цены и количество записываются в строку `Waybills` в момент
 * отправки, и поздняя правка заявки документ, уже ушедший клиенту, не меняет.
 *
 * Что считается «частью»: строки журнала отгрузок заявки, которые ещё не вошли ни в одну накладную. Зав. складом часто
 * отгружает заявку по позиции за нажатие — накладная на каждое нажатие была бы спамом, поэтому:
 * - весь цветок одной компании по заявке отгружен — накладная уходит сразу;
 * - отгружено не всё (на складе не хватило) — через `WAYBILL_QUIET_MINUTES` тишины уходит на то, что отгрузили.
 */

export const WAYBILL_AUTO_SETTING = "WaybillAuto";
/** С какой минуты отгрузки идут в накладные: всё, что отгружено раньше, сама программа клиенту не шлёт никогда. */
export const WAYBILL_SINCE_SETTING = "WaybillSince";
export const WAYBILL_LAST_RUN = "WaybillLastRun";
export const WAYBILL_QUIET_MINUTES = 20;
/** Старше — сама не шлёт: накладная на позавчерашнюю отгрузку выглядит ошибкой. Кнопка на заявке остаётся. */
export const WAYBILL_MAX_AGE_HOURS = 48;
/** Клиенту не пишем ночью: отгрузка в шесть утра — накладная в семь. */
export const WAYBILL_HOURS = { from: 7, to: 22 };

export type WaybillStatus = "sending" | "sent" | "failed" | "skipped" | "duplicate";

export const WAYBILL_STATUS_LABELS: Record<WaybillStatus, string> = {
  sending: "отправляется",
  sent: "отправлена",
  failed: "не отправлена",
  skipped: "не отправлялась",
  duplicate: "повтор",
};

export interface WaybillLine {
  farm: string;
  name: string;
  quantity: number;
  price: number;
  amount: number;
}

export interface WaybillDoc {
  /** «CRN6Y» у первой накладной заявки, «CRN6Y-2» у второй. */
  number: string;
  orderCode: string;
  /** День накладной по Алматы, ГГГГ-ММ-ДД. */
  date: string;
  client: string;
  city: string;
  manager: string;
  deliveryDate: string;
  shippedBy: string;
  lines: WaybillLine[];
  stems: number;
  amount: number;
  /** Сколько по заявке ещё не отгружено на момент накладной. */
  restStems: number;
  /** Образец для показа — не документ. */
  sample?: boolean;
}

export interface WaybillRow {
  waybillId: string;
  createdAt: string;
  orderId: string;
  number: string;
  shipmentIds: string[];
  doc: WaybillDoc | null;
  stems: number;
  amount: number;
  phone: string;
  line: string;
  status: WaybillStatus;
  note: string;
  messageId: string;
  byEmail: string;
  sentAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseWaybillStatus(raw: string | null | undefined): WaybillStatus {
  const v = String(raw || "").trim().toLowerCase();
  return v === "sent" || v === "failed" || v === "skipped" || v === "duplicate" ? v : "sending";
}

/** Включена ли автоотправка и с какой минуты. Без даты начала — выключена: слать «всё, что было» нельзя. */
export function waybillAuto(map: Record<string, string | undefined>): { on: boolean; since: string } {
  const since = String(map[WAYBILL_SINCE_SETTING] || "").trim();
  const valid = since && !Number.isNaN(Date.parse(since));
  return { on: String(map[WAYBILL_AUTO_SETTING] || "").trim().toLowerCase() === "on" && Boolean(valid), since: valid ? since : "" };
}

type OrderLike = {
  orderId: string;
  status: string;
  retail?: string;
  kind?: string;
  direction?: string;
  clientName?: string;
  clientPhone?: string;
  managerEmail?: string;
  deliveryDate?: string;
  items: { itemId: string; flowerType: string; variety: string; grade: string; quantity: number; unitPrice: number; shippedQuantity: number }[];
};

/** Почему по этой заявке накладной клиенту не бывает. Пусто — бывает. */
export function waybillOrderRefusal(order: Pick<OrderLike, "status" | "retail" | "kind" | "direction" | "clientName">): string {
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка отменена";
  if (isNotASale(order)) return "Это не продажа клиенту (наш магазин, объём на город или точка) — накладная клиенту не нужна";
  return "";
}

type ShipLike = { shipmentId: string; itemId: string; quantity: number; createdAt: string };

/** Строки отгрузки заявки, которые ещё не вошли ни в одну накладную («повтор» не считается). */
export function uncoveredShipments(shipments: ShipLike[], waybills: Pick<WaybillRow, "shipmentIds" | "status">[]): ShipLike[] {
  const covered = new Set(waybills.filter((w) => w.status !== "duplicate").flatMap((w) => w.shipmentIds));
  return shipments.filter((s) => s.quantity > 0 && s.shipmentId && !covered.has(s.shipmentId));
}

export type WaybillPlan = { send: string[]; why: "complete" | "quiet" | "manual" } | { wait: string } | null;

/**
 * Что отправлять по заявке сейчас. null — нечего; `wait` — есть что, но рано (и почему).
 * `manual` — кнопка на заявке: всё, что не вошло в накладные, без оглядки на время и дату включения.
 */
export function planWaybill(input: {
  order: OrderLike;
  shipments: ShipLike[];
  waybills: Pick<WaybillRow, "shipmentIds" | "status">[];
  mode: "auto" | "manual";
  since?: string;
  now: Date;
}): WaybillPlan {
  if (waybillOrderRefusal(input.order)) return null;
  const itemFarm = new Map(input.order.items.map((i) => [i.itemId, getFarmFor(i.flowerType) ?? ""]));
  // Строка отгрузки по позиции, которой в заявке уже нет (позицию убрали правкой), в накладную не идёт: нечего назвать.
  let pending = uncoveredShipments(input.shipments, input.waybills).filter((s) => itemFarm.has(s.itemId));
  if (input.mode === "manual") return pending.length ? { send: pending.map((s) => s.shipmentId), why: "manual" } : null;

  const sinceMs = Date.parse(input.since || "");
  if (Number.isNaN(sinceMs)) return null;
  const nowMs = input.now.getTime();
  const at = (s: ShipLike) => Date.parse(s.createdAt);
  pending = pending.filter((s) => {
    const t = at(s);
    return !Number.isNaN(t) && t >= sinceMs && nowMs - t <= WAYBILL_MAX_AGE_HOURS * 3600000;
  });
  if (pending.length === 0) return null;

  const done = new Set<string>();
  for (const farm of new Set(itemFarm.values())) {
    const own = input.order.items.filter((i) => (getFarmFor(i.flowerType) ?? "") === farm && i.quantity > 0);
    if (own.length > 0 && own.every((i) => i.shippedQuantity >= i.quantity)) done.add(farm);
  }
  const newest = Math.max(...pending.map(at));
  if (nowMs - newest >= WAYBILL_QUIET_MINUTES * 60000) return { send: pending.map((s) => s.shipmentId), why: "quiet" };
  const complete = pending.filter((s) => done.has(itemFarm.get(s.itemId) ?? ""));
  if (complete.length > 0) return { send: complete.map((s) => s.shipmentId), why: "complete" };
  const left = Math.max(1, Math.ceil((WAYBILL_QUIET_MINUTES * 60000 - (nowMs - newest)) / 60000));
  return { wait: `заявка отгружена не полностью — накладная уйдёт, когда склад догрузит, или через ${left} мин.` };
}

/** Номер следующей накладной заявки: первая — номер заявки, дальше «-2», «-3». */
export function nextWaybillNumber(orderId: string, waybills: Pick<WaybillRow, "status">[]): string {
  const n = waybills.filter((w) => w.status !== "duplicate").length + 1;
  const code = orderCode(orderId);
  return n === 1 ? code : `${code}-${n}`;
}

/** Название позиции в накладной: «Хризантема Altaj, Вторая», «Роза Jana, 60 см». Хозяйство названо заголовком раздела. */
export function waybillItemName(item: { flowerType: string; variety: string; grade: string }): string {
  const flower = item.flowerType === "chrysanthemum_rf" ? "Хризантема" : FLOWER_TYPE_LABELS[item.flowerType] ?? item.flowerType;
  return `${flower}${item.variety ? ` ${item.variety}` : ""}${item.grade ? `, ${formatGrade(item.grade)}` : ""}`;
}

/** Снимок накладной по выбранным строкам отгрузки. Строка на позицию заявки; цена — цена позиции. */
export function buildWaybillDoc(input: {
  order: OrderLike;
  shipments: ShipLike[];
  shipmentIds: string[];
  number: string;
  date: string;
  city: string;
  manager: string;
  shippedBy: string;
}): WaybillDoc {
  const ids = new Set(input.shipmentIds);
  const qty = new Map<string, number>();
  for (const s of input.shipments) if (ids.has(s.shipmentId) && s.quantity > 0) qty.set(s.itemId, (qty.get(s.itemId) ?? 0) + s.quantity);
  const lines: WaybillLine[] = [];
  const farmRank = (farm: string) => {
    const i = FARM_ORDER.indexOf(farm);
    return i < 0 ? FARM_ORDER.length : i;
  };
  for (const item of input.order.items) {
    const q = qty.get(item.itemId) ?? 0;
    if (q <= 0) continue;
    const price = Number(item.unitPrice) || 0;
    lines.push({ farm: getFarmFor(item.flowerType) ?? "", name: waybillItemName(item), quantity: q, price, amount: round2(q * price) });
  }
  lines.sort((a, b) => farmRank(a.farm) - farmRank(b.farm));
  return {
    number: input.number,
    orderCode: orderCode(input.order.orderId),
    date: input.date,
    client: (input.order.clientName || "").trim(),
    city: input.city.trim(),
    manager: input.manager.trim(),
    deliveryDate: input.order.deliveryDate || "",
    shippedBy: input.shippedBy.trim(),
    lines,
    stems: lines.reduce((s, l) => s + l.quantity, 0),
    amount: round2(lines.reduce((s, l) => s + l.amount, 0)),
    restStems: input.order.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0),
  };
}

/** Разделы накладной по компаниям, в порядке `FARM_ORDER`. */
export function waybillSections(doc: WaybillDoc): { farm: string; label: string; lines: WaybillLine[]; stems: number; amount: number }[] {
  const farms = Array.from(new Set(doc.lines.map((l) => l.farm)));
  return farms.map((farm) => {
    const lines = doc.lines.filter((l) => l.farm === farm);
    return { farm, label: FARM_LABELS[farm] ?? "Ecoculture", lines, stems: lines.reduce((s, l) => s + l.quantity, 0), amount: round2(lines.reduce((s, l) => s + l.amount, 0)) };
  });
}

const money = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ")} ₸`;
const stemsText = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/[  ]/g, " ")} шт.`;

/** Больше стольких строк — накладная уходит файлом PDF: высокую картинку WhatsApp сжимает до нечитаемой. */
export const WAYBILL_IMAGE_MAX_LINES = 12;
export const waybillIsPdf = (doc: Pick<WaybillDoc, "lines">) => doc.lines.length > WAYBILL_IMAGE_MAX_LINES;

/** Подпись к накладной: коротко, цифры те же, что в документе. Обещаний про остаток нет — только факт. */
export function waybillCaption(doc: WaybillDoc): string {
  const what = `${stemsText(doc.stems)} на ${money(doc.amount)}`;
  const where = waybillIsPdf(doc) ? "Накладная в файле." : "Накладная на картинке.";
  if (doc.restStems > 0) return `Здравствуйте! Отгрузили часть заказа № ${doc.orderCode}: ${what}. ${where} По заказу осталось отгрузить ${stemsText(doc.restStems)}`;
  return `Здравствуйте! Заказ № ${doc.orderCode} отгружен: ${what}. ${where}`;
}

/** Имя файла для WhatsApp — латиницей. Расширение решает, что отдаст адрес накладной: картинку или PDF. */
export function waybillFileName(doc: Pick<WaybillDoc, "number" | "lines">): string {
  return `Nakladnaya-${doc.number.replace(/[^A-Za-z0-9-]+/g, "") || "Ecoculture"}.${waybillIsPdf(doc) ? "pdf" : "jpg"}`;
}

/**
 * Кому слать. `auto` не пишет сотрудникам (заявка на своего), без мобильного номера и тем, кто просил не писать;
 * кнопка на заявке «просил не писать» обходит — это решение человека, а не автомата.
 */
/** Начало пометки «накладная не отправлялась», по которой проход возвращается к строке сам (`waybillRedo`). */
export const WAYBILL_SKIP_NO_PHONE = "нет мобильного номера клиента";
export const WAYBILL_SKIP_OPT_OUT = "клиент просил не писать";

/**
 * Кому слать. Накладная — документ о покупке, а не рассылка: с 24.11.2026 она уходит и тем, кто отписался от рассылок
 * или кого сотрудник просил «не писать» (владелец: «почему ты реально не отправляешь накладные клиентам, которые
 * купили? Ты обязан это делать всегда» — за три дня так не ушло 7 накладных из 58). Не шлём только когда слать некуда
 * (нет мобильного номера) или номер клиента — номер нашего сотрудника.
 */
export function waybillRecipient(input: {
  order: Pick<OrderLike, "clientPhone">;
  client: { phone?: string; messenger?: string } | null;
  staffKeys: Set<string>;
  mode: "auto" | "manual";
}): { phone: string } | { skip: string } {
  const phone = waPhone(input.order.clientPhone) || waPhone(input.client?.phone) || waPhone(input.client?.messenger);
  if (!phone) return { skip: `${WAYBILL_SKIP_NO_PHONE} — в заявке и в карточке` };
  const key = phoneKey(phone);
  if (input.staffKeys.has(key)) return { skip: "номер клиента — номер нашего сотрудника" };
  return { phone };
}

/**
 * Что с номером WhatsApp прямо сейчас. `ok` — подключён, через него можно слать. `down` — точно отключён (ключей нет,
 * Green API ответил «не авторизован», «заблокирован» или отказал по ключу/оплате): через него не шлём, а уже
 * «отправленное» через него считаем недоставленным. `unknown` — Green API не ответил, номер запускается: через такой
 * номер не шлём, но и недоставленным ничего не объявляем — «не знаю» не должно стать второй накладной клиенту.
 */
export type LineHealth = "ok" | "down" | "unknown";
export function lineHealth(input: { hasKeys: boolean; state?: string; errorStatus?: number }): LineHealth {
  if (!input.hasKeys) return "down";
  if (input.state === "authorized") return "ok";
  if (input.state === "notAuthorized" || input.state === "blocked") return "down";
  if (input.state) return "unknown";
  return input.errorStatus === 400 || input.errorStatus === 401 || input.errorStatus === 403 || input.errorStatus === 466 ? "down" : "unknown";
}

/** Через столько минут после отправки проверяем, не ушла ли накладная в отключённый номер. */
export const WAYBILL_RESEND_AFTER_MINUTES = 10;
export const WAYBILL_RESEND_NOTE = "отправлена повторно";

/**
 * Накладная, к которой проход должен вернуться сам (24.11.2026, «ты обязан это делать всегда»). Только свежие — не
 * старше `WAYBILL_MAX_AGE_HOURS`: накладная за прошлую неделю клиента уже только запутает.
 *
 * - `skipped` — автомат не отправил, потому что не было мобильного номера или клиент был в списке «не писать»
 *   (старое правило): номер появился или правило снято — отправляем;
 * - `dead-line` — отправлена через номер МЕНЕДЖЕРА. Green API принимает сообщение и тогда, когда номер отключён от
 *   WhatsApp (QR слетел): кладёт в очередь и отвечает «принято», а клиенту ничего не приходит. Так с 4 по 24.11 стоял
 *   номер Ильгара — накладные его клиентам числились «отправлено». Это только кандидат: проход проверяет, что номер
 *   и сейчас отключён и что отметки о доставке нет, — и тогда шлёт ещё раз с рабочего номера. Один раз
 *   (`WAYBILL_RESEND_NOTE`).
 */
export function waybillRedo(w: Pick<WaybillRow, "status" | "note" | "createdAt" | "line" | "byEmail">, now: Date): "skipped" | "dead-line" | null {
  const age = now.getTime() - Date.parse(w.createdAt);
  if (!(age >= 0) || age > WAYBILL_MAX_AGE_HOURS * 3600000) return null;
  if (w.status === "skipped" && w.byEmail === "auto" && (w.note.startsWith(WAYBILL_SKIP_NO_PHONE) || w.note.startsWith(WAYBILL_SKIP_OPT_OUT))) return "skipped";
  if (w.status === "sent" && !!w.line && w.line !== "main" && !w.note.includes(WAYBILL_RESEND_NOTE) && age >= WAYBILL_RESEND_AFTER_MINUTES * 60000) return "dead-line";
  return null;
}

/** Можно ли сейчас писать клиенту самой программе (час по Алматы). */
export function waybillHourOk(hour: number): boolean {
  return hour >= WAYBILL_HOURS.from && hour < WAYBILL_HOURS.to;
}

/**
 * Кто отправляет накладную кнопкой на заявке: администратор, РОП и бухгалтер — любую; продающие роли — по своей заявке
 * или своему клиенту; склад — да (он её и собрал). Остальным (маркетолог, агроном) — нет.
 */
export function waybillSendRefusal(input: { role: string | null | undefined; email: string | null | undefined; order: Pick<OrderLike, "status" | "retail" | "kind" | "direction" | "clientName" | "managerEmail">; cardManagerEmail?: string }): string {
  const order = waybillOrderRefusal(input.order);
  if (order) return order;
  const role = input.role || "";
  if (role === ROLES.ADMIN || role === ROLES.SALES_HEAD || canEditFinance(role)) return "";
  if (role === ROLES.WAREHOUSE || role === ROLES.OFFICE || role === ROLES.OFFICE_RETAIL) return "";
  if (!canSellToClients(role)) return "Накладную клиенту отправляет менеджер заявки, склад или бухгалтер";
  const me = (input.email || "").trim().toLowerCase();
  const mine = me && [(input.order.managerEmail || "").toLowerCase(), (input.cardManagerEmail || "").toLowerCase()].includes(me);
  return mine ? "" : "Это заявка другого менеджера — накладную отправит он, РОП или бухгалтер";
}

/** Линии, с которых пробуем отправить, по порядку: где клиент переписывался последним → номер менеджера заявки → основной. */
export function waybillLineOrder(input: { chatLines: string[]; managerLine: string }): string[] {
  const out: string[] = [];
  for (const code of [...input.chatLines, input.managerLine, ""]) if (code !== undefined && code !== null && !out.includes(code)) out.push(code);
  return out.slice(0, 4);
}

/** «Отправляется» дольше стольких минут — отправка оборвалась на полпути (сбой таблицы, функцию сняли). */
export const WAYBILL_STUCK_MINUTES = 3;
export const WAYBILL_RETRY_NOTE = "повтор после обрыва";

type TraceMessage = { messageId: string; at: string; phone: string; direction: string; type: string; text: string; line?: string };

/**
 * След накладной в переписке: ушла ли она клиенту на самом деле. 19.11.2026, первый же день: накладная № YOMGH ушла
 * клиенту, а запись «отправлена» в таблицу не легла — строка осталась «отправляется», и кнопка «Отправить» прислала бы
 * её второй раз. Ищем исходящее этому номеру после заведения строки: нашу запись с пометкой «[накладная № …]» или эхо
 * WhatsApp — файл с подписью накладной по этой заявке (эхо приходит уведомлением, пометки в нём нет).
 */
export function waybillSentTrace(w: Pick<WaybillRow, "number" | "phone" | "createdAt"> & { orderCode: string }, messages: TraceMessage[]): { messageId: string; line: string; at: string } | null {
  const key = phoneKey(w.phone);
  if (!key) return null;
  const from = Date.parse(w.createdAt) - 60000;
  const mine = messages
    .filter((m) => m.direction === "out" && phoneKey(m.phone) === key && Date.parse(m.at) >= from)
    .filter((m) => m.text.includes(`[накладная № ${w.number}]`) || ((m.type === "image" || m.type === "document") && m.text.includes(`№ ${w.orderCode}`) && /Накладная (на картинке|в файле)/.test(m.text)))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  // Наша запись точнее эха: в ней номер сообщения и линия ровно те, с которыми отправляли.
  const hit = mine.find((m) => m.text.includes(`[накладная № ${w.number}]`)) ?? mine[0];
  return hit ? { messageId: hit.messageId, line: hit.line || "main", at: hit.at } : null;
}

/**
 * Что делать с накладной, застрявшей в «отправляется»: след в переписке есть — она отправлена; следа нет — одна
 * повторная попытка; уже повторяли или прошли сутки — «не отправлена», дальше решает человек кнопкой на заявке.
 */
export function stuckWaybillAction(w: Pick<WaybillRow, "status" | "createdAt" | "note">, traced: boolean, now: Date): "sent" | "retry" | "fail" | null {
  if (w.status !== "sending") return null;
  const age = now.getTime() - Date.parse(w.createdAt);
  if (!(age >= WAYBILL_STUCK_MINUTES * 60000)) return null;
  if (traced) return "sent";
  if (w.note.startsWith(WAYBILL_RETRY_NOTE) || age > 24 * 3600000) return "fail";
  return "retry";
}

/** Образец для страницы настроек и проверки после выкладки. Клиент и позиции выдуманы и подписаны как образец. */
export function sampleWaybillDoc(date: string): WaybillDoc {
  const lines: WaybillLine[] = [
    { farm: "rose_farm", name: "Роза Jana, 60 см", quantity: 150, price: 410, amount: 61500 },
    { farm: "rose_farm", name: "Эустома Alissa Pink, 70 см", quantity: 50, price: 450, amount: 22500 },
    { farm: "esentai", name: "Хризантема Altaj, Вторая", quantity: 200, price: 400, amount: 80000 },
    { farm: "esentai", name: "Хризантема Zembla, Третья", quantity: 100, price: 300, amount: 30000 },
  ];
  return {
    number: "A1B2C",
    orderCode: "A1B2C",
    date,
    client: "Образец · Салон «Пример»",
    city: "Алматы",
    manager: "Имя менеджера",
    deliveryDate: date,
    shippedBy: "Имя зав. складом",
    lines,
    stems: lines.reduce((s, l) => s + l.quantity, 0),
    amount: lines.reduce((s, l) => s + l.amount, 0),
    restStems: 0,
    sample: true,
  };
}
