import { forgetReads, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import { listOrdersWithItems } from "./repo/orders";
import { listShipments } from "./repo/shipments";
import { listClients } from "./repo/clients";
import { listUsers } from "./repo/users";
import { listWaStatuses, settingsMap } from "./repo/broadcasts";
import { deliveryByMessage } from "./broadcast";
import { listWaMessages, waMessagesAppendOp } from "./repo/talks";
import { assistantLogAppendOp, lineConfig, listWaLines } from "./repo/waLines";
import { createWaybill, finishWaybill, listWaybills, listWaybillsStrict, type WaybillChanges } from "./repo/waybills";
import { notifyLineManager, ourPhoneKeys } from "./lineNotify";
import { GreenError, getInstanceState, greenConfig, sendFileByUrl, sendText, type GreenConfig } from "./greenApi";
import { waPhone } from "./broadcast";
import { orderCode } from "./paymentStage";
import { publicWaybillUrl } from "./waFileSign";
import { phoneKey } from "./leads";
import { getFarmFor } from "./constants";
import { siteOrigin } from "./waybillKick";
import {
  WAYBILL_RESEND_NOTE,
  WAYBILL_RETRY_NOTE,
  WAYBILL_SKIP_NO_PHONE,
  WAYBILL_SKIP_OPT_OUT,
  buildWaybillDoc,
  nextWaybillNumber,
  planWaybill,
  stuckWaybillAction,
  waybillAuto,
  waybillCaption,
  waybillFileName,
  waybillHourOk,
  waybillIsPdf,
  waybillLineOrder,
  waybillOrderRefusal,
  waybillRecipient,
  waybillRedo,
  waybillSentTrace,
  lineHealth,
  type LineHealth,
  type WaybillDoc,
  type WaybillRow,
} from "./waybill";
import type { OrderWithItems, Shipment, WaMessage } from "./types";

/**
 * Накладная клиенту: собрать, отправить, записать (правила — `waybill.ts`).
 *
 * Порядок один и для автомата, и для кнопки на заявке: строка в `Waybills` заводится ДО отправки и занимает за собой
 * строки журнала отгрузок (второй проход ту же отгрузку не возьмёт), затем файл уходит клиенту ссылкой, затем в строку
 * пишется итог. Отправка не удалась — строка остаётся «не отправлена» с причиной; сама программа её не повторяет
 * (повторять молча — значит однажды прислать клиенту три накладные подряд), повторяет человек кнопкой на заявке.
 *
 * ЧТЕНИЙ — КАК МОЖНО МЕНЬШЕ. 19.11.2026, первый день: склад отгружал заявку каждые 15–20 секунд, каждая отгрузка будила
 * проход, а проход читал таблицу восемь раз и писал пять — и вместе со страницами склада упёрся в общий лимит Google
 * (грабли 1.17): из девятнадцати накладных три застряли в «отправляется». Теперь всё нужное читается ДО первой записи
 * двумя пакетами (второй — только если есть что отправлять) и держится в памяти прохода, а на накладную остаётся одно
 * чтение (проверка «не взял ли ту же отгрузку другой проход») и две записи (строка и итог одним запросом).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const almatyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d)) % 24;
const firstName = (name: string | undefined) => (name || "").trim().split(/\s+/)[0] || "";

export interface WaybillOutcome {
  status: WaybillRow["status"];
  number: string;
  note: string;
  phone: string;
}

type WaybillRef = Pick<WaybillRow, "waybillId" | "doc" | "phone"> & { rowNumber?: number };

/**
 * Записать итог в строку накладной — с повторами. Одна неудачная запись (таблица не ответила) в первый же день оставила
 * отправленную накладную в «отправляется»; итог отправки терять нельзя, поэтому три попытки с паузами. Не вышло —
 * false: строку позже разберёт проход по следу в переписке (`healStuckWaybills`).
 */
async function setWaybill(row: { waybillId: string; rowNumber?: number }, changes: WaybillChanges, extra: WriteOp[] = []): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await finishWaybill(row, changes, extra);
      return true;
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return false;
}

/** Что отправке нужно знать о переписке и номерах — прочитано заранее, до первой записи. */
interface SendCtx {
  messages: WaMessage[];
  managerLines: { code: string; managerEmail: string }[];
  /** Подключён ли номер к WhatsApp прямо сейчас — спрашиваем Green API один раз на проход (`usableLine`). */
  lineState: LineStates;
}

type LineStates = Map<string, { cfg: GreenConfig | null; health: LineHealth }>;

/**
 * Номер, с которого сейчас действительно можно отправить: ключи есть И номер подключён к WhatsApp. Проверка состояния
 * обязательна (24.11.2026): Green API принимает сообщение и у отключённого номера — кладёт в очередь и отвечает
 * «принято», а клиент ничего не получает. Номер Ильгара так простоял с 4 ноября: накладные его клиентам числились
 * отправленными. Не ответил или не «authorized» — номером не пользуемся, идём к следующему.
 */
async function lineNow(code: string, states: LineStates): Promise<{ cfg: GreenConfig | null; health: LineHealth }> {
  const known = states.get(code);
  if (known) return known;
  let cfg: GreenConfig | null = null;
  let health: LineHealth = "unknown";
  try {
    cfg = await lineConfig(code === "main" ? "" : code);
  } catch {
    cfg = null; // вкладка номеров не прочиталась — «не знаю», а не «отключён»
    states.set(code, { cfg, health });
    return { cfg, health };
  }
  if (!cfg) health = lineHealth({ hasKeys: false });
  else {
    try {
      health = lineHealth({ hasKeys: true, state: await getInstanceState(cfg) });
    } catch (err) {
      health = lineHealth({ hasKeys: true, errorStatus: err instanceof GreenError ? err.status : 0 });
    }
  }
  const out = { cfg: health === "ok" ? cfg : null, health };
  states.set(code, out);
  return out;
}

async function usableLine(code: string, states: LineStates): Promise<GreenConfig | null> {
  return (await lineNow(code, states)).cfg;
}

async function loadSendCtx(lineState: LineStates = new Map()): Promise<SendCtx> {
  const [messages, lines] = await Promise.all([listWaMessages({ lines: "all" }), listWaLines().catch(() => [])]);
  return { messages, managerLines: lines.filter((l) => l.active).map((l) => ({ code: l.code, managerEmail: l.managerEmail.toLowerCase() })), lineState };
}

/**
 * Отправить готовую строку накладной клиенту. Пробует номера по порядку (`waybillLineOrder`), пишет итог в строку.
 * После того как сообщение ушло, функция НЕ бросает ошибок: иначе вызывающий принял бы отправленное за неотправленное.
 */
export async function deliverWaybill(row: WaybillRef, order: Pick<OrderWithItems, "managerEmail">, byEmail: string, send: SendCtx, sentNote = ""): Promise<WaybillOutcome> {
  const doc = row.doc as WaybillDoc;
  const done = async (status: "sent" | "failed", note: string, extra: Partial<Record<"MessageID" | "Line" | "SentAt", string>> = {}, ops: WriteOp[] = []): Promise<WaybillOutcome> => {
    await setWaybill(row, { Status: status, Note: note.slice(0, 300), ByEmail: byEmail, Phone: row.phone, ...extra }, ops);
    return { status, number: doc.number, note, phone: row.phone };
  };
  const fileName = waybillFileName(doc);
  const url = publicWaybillUrl(siteOrigin(), row.waybillId, fileName);
  // Сначала открываем файл сами: убеждаемся, что он собирается (иначе клиенту уйдёт подпись без накладной), и
  // прогреваем кэш — Green API скачает его без ожидания. Один повтор: файл читает ту же таблицу и мог упереться в лимит.
  let fileOk = false;
  let fileNote = "файл накладной не собрался — сайт не ответил";
  for (let i = 0; i < 2 && !fileOk; i++) {
    if (i > 0) await sleep(4000);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      fileOk = res.ok;
      if (!res.ok) fileNote = `файл накладной не собрался (ответ ${res.status})`;
    } catch {
      /* ниже — повтор или отказ */
    }
  }
  if (!fileOk) return done("failed", fileNote);

  const key = phoneKey(row.phone);
  const chatLines = send.messages
    .filter((m) => phoneKey(m.phone) === key)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((m) => m.line || "");
  const managerLine = send.managerLines.find((l) => l.managerEmail === (order.managerEmail || "").toLowerCase())?.code;
  const caption = waybillCaption(doc);
  let lastError = "ни один номер WhatsApp сейчас не подключён — отсканируйте QR в «Настройки → WhatsApp менеджеров»";
  for (const code of waybillLineOrder({ chatLines: Array.from(new Set(chatLines)), managerLine: managerLine ?? "" })) {
    // Только через номер, который подключён к WhatsApp прямо сейчас: отключённый «принимает» и не доставляет.
    const cfg = await usableLine(code, send.lineState);
    if (!cfg) continue;
    let id = "";
    try {
      id = await sendFileByUrl(cfg, row.phone, url, fileName, caption);
    } catch (err) {
      lastError = err instanceof GreenError || err instanceof Error ? err.message : String(err);
      continue;
    }
    const now = new Date().toISOString();
    // В переписку и журнал — как любое сообщение из CRM: бот и помощник видят, что накладная ушла, и не считают её
    // ответом менеджера. Вместе с итогом — одной записью: либо всё легло, либо строку разберёт проход по эху WhatsApp.
    return done("sent", sentNote, { MessageID: id, Line: code || "main", SentAt: now }, [
      waMessagesAppendOp([
        { messageId: id, at: now, chatId: `${row.phone}@c.us`, phone: row.phone, direction: "out", type: waybillIsPdf(doc) ? "document" : "image", text: `[накладная № ${doc.number}] ${caption}`, mediaUrl: "", senderName: "", source: "crm", line: code },
      ]),
      assistantLogAppendOp([{ at: now, line: code, phone: row.phone, kind: "crm", messageId: id, text: caption, note: `накладная № ${doc.number}`, byEmail }]),
    ]);
  }
  return done("failed", lastError);
}

interface Ctx extends SendCtx {
  clients: Awaited<ReturnType<typeof listClients>>;
  users: Awaited<ReturnType<typeof listUsers>>;
  staffKeys: Set<string>;
}

/**
 * Всё, что нужно для отправки, — одним пакетным чтением и ДО первой записи: запись сбрасывает память чтений, и всё,
 * что спросили бы после неё, ушло бы в Google заново, по вкладке за раз.
 */
async function loadCtx(map: Record<string, string>, lineState: LineStates = new Map()): Promise<Ctx> {
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.CLIENTS]).catch(() => undefined);
  const [clients, users, staffKeys, send] = await Promise.all([listClients(), listUsers(), ourPhoneKeys(map), loadSendCtx(lineState)]);
  return { clients, users, staffKeys, ...send };
}

/**
 * Завести накладную на выбранные строки отгрузки и отправить. Перед отправкой — «занять» отгрузку: записать строку,
 * подождать, перечитать; если ту же отгрузку одновременно взял другой проход (два нажатия склада подряд — два запуска),
 * остаётся более ранняя строка, а наша помечается «повтор» и не отправляется.
 */
async function issueWaybill(input: { order: OrderWithItems; shipments: Shipment[]; shipmentIds: string[]; waybills: WaybillRow[]; mode: "auto" | "manual"; byEmail: string; ctx: Ctx }): Promise<WaybillOutcome> {
  const { order, ctx } = input;
  const client = ctx.clients.find((c) => c.clientId === order.clientId) ?? null;
  const userName = (email: string) => firstName(ctx.users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.name);
  const chosen = input.shipments.filter((s) => input.shipmentIds.includes(s.shipmentId));
  const lastShipper = chosen.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.warehouseEmail || "";
  const doc = buildWaybillDoc({
    order,
    shipments: input.shipments,
    shipmentIds: input.shipmentIds,
    number: nextWaybillNumber(order.orderId, input.waybills),
    date: localDayKey(),
    city: client?.city || "",
    manager: userName(order.managerEmail || ""),
    shippedBy: userName(lastShipper),
  });
  if (doc.lines.length === 0) return { status: "skipped", number: doc.number, note: "в отгрузке нет позиций заявки", phone: "" };
  const to = waybillRecipient({ order, client, staffKeys: ctx.staffKeys, mode: input.mode });
  const skip = "skip" in to ? to.skip : "";
  const phone = "skip" in to ? "" : to.phone;
  const row = await createWaybill({ orderId: order.orderId, shipmentIds: input.shipmentIds, doc, phone, status: skip ? "skipped" : "sending", note: skip, byEmail: input.byEmail });
  await sleep(1200);
  // Кто раньше — сравниваем по тому, что ЛЕЖИТ В ТАБЛИЦЕ у обеих строк (своё время тоже перечитываем): таблица может
  // вернуть дату не так, как мы её записали, и сравнение «моя из памяти против чужой из таблицы» дало бы двум проходам
  // разные ответы. Строка, которую другой проход уже довёл до конца, старше всегда.
  const fresh = await listWaybillsStrict();
  const me = fresh.find((w) => w.waybillId === row.waybillId);
  const ref: WaybillRef = { waybillId: row.waybillId, doc, phone, rowNumber: me?.rowNumber };
  const myAt = me?.createdAt || row.createdAt;
  const mine = new Set(input.shipmentIds);
  const rival = fresh.find(
    (w) =>
      w.orderId === order.orderId &&
      w.waybillId !== row.waybillId &&
      w.status !== "duplicate" &&
      w.shipmentIds.some((id) => mine.has(id)) &&
      (w.createdAt < myAt || (w.createdAt === myAt && w.waybillId < row.waybillId) || (w.status !== "sending" && w.status !== "skipped"))
  );
  if (rival) {
    await setWaybill(ref, { Status: "duplicate", Note: `та же отгрузка уже в накладной № ${rival.number}` });
    return { status: "duplicate", number: doc.number, note: `уже в накладной № ${rival.number}`, phone };
  }
  if (skip) return { status: "skipped", number: doc.number, note: skip, phone: "" };
  return deliverWaybill(ref, order, input.byEmail, ctx);
}

/**
 * Накладные, застрявшие в «отправляется» (`stuckWaybillAction`): есть след в переписке — «отправлена»; нет — одна
 * повторная отправка; не вышло и со второй — «не отправлена», дальше кнопка на заявке.
 */
async function healStuckWaybills(stuck: (WaybillRow & { rowNumber?: number })[], orders: Map<string, OrderWithItems>, result: WaybillRunResult, canSend: () => boolean, send: SendCtx): Promise<void> {
  const now = new Date();
  for (const w of stuck) {
    const trace = waybillSentTrace({ number: w.number, phone: w.phone, createdAt: w.createdAt, orderCode: w.doc!.orderCode }, send.messages);
    const action = stuckWaybillAction(w, !!trace, now);
    if (action === "sent" && trace) {
      await setWaybill(w, { Status: "sent", Note: "", MessageID: trace.messageId, Line: trace.line, SentAt: trace.at });
      result.notes.push(`№ ${w.number}: уже ушла клиенту — отметка восстановлена по переписке`);
    } else if (action === "fail") {
      await setWaybill(w, { Status: "failed", Note: "отправка оборвалась — отправьте кнопкой на заявке" });
      result.failed += 1;
      result.notes.push(`№ ${w.number}: failed — отправка оборвалась`);
    } else if (action === "retry") {
      const order = orders.get(w.orderId);
      if (!order || waybillOrderRefusal(order) || !w.phone || !canSend()) continue;
      // Отметка о повторе пишется ДО отправки: не записалась — не шлём, иначе при новом обрыве повторяли бы без конца.
      if (!(await setWaybill(w, { Note: WAYBILL_RETRY_NOTE }))) continue;
      const out = await deliverWaybill(w, order, "auto", send);
      if (out.status === "sent") result.sent += 1;
      else result.failed += 1;
      result.notes.push(`№ ${out.number}: ${out.status} (повтор после обрыва)${out.note ? ` — ${out.note}` : ""}`);
    }
  }
}

export interface WaybillRunResult {
  off?: string;
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
  notes: string[];
}

/**
 * Автомат: пройти заявки с отгрузками, ещё не вошедшими в накладные, и отправить, кому пора (`planWaybill`).
 * `orderId` — заявка, по которой только что отгружали: она идёт первой.
 */
export async function runWaybills(opts: { orderId?: string; limit?: number; budgetMs?: number } = {}): Promise<WaybillRunResult> {
  const started = Date.now();
  const result: WaybillRunResult = { sent: 0, failed: 0, skipped: 0, waiting: 0, notes: [] };
  forgetReads();
  // Первый пакет — то, без чего не решить, есть ли работа. Нет работы — проход стоил таблице одного чтения.
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.SHIPMENTS, SHEET_TABS.WAYBILLS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS]).catch(() => undefined);
  const map = await settingsMap();
  const auto = waybillAuto(map);
  if (!auto.on) return { ...result, off: "автоотправка накладных выключена" };
  const now = new Date();
  if (!waybillHourOk(almatyHour(now))) return { ...result, off: "ночь — клиентам не пишем" };

  const sinceMs = Date.parse(auto.since);
  // Журнал отгрузок и накладные читаем строго: «не прочиталось» нельзя принять за «нет» — ушли бы повторы.
  const shipments = (await listShipments()).filter((s) => Date.parse(s.createdAt) >= sinceMs);
  const waybills = await listWaybillsStrict({ fresh: false });
  const orders = new Map((await listOrdersWithItems()).map((o) => [o.orderId, o]));
  // Не больше трёх отправок за проход и ни одной новой после 30-й секунды: функция живёт минуту, и отправка,
  // оборванная на полпути, хуже отправки, отложенной до следующего прохода.
  const limit = opts.limit ?? 3;
  const budget = opts.budgetMs ?? 30000;
  const canSend = () => result.sent + result.failed + result.skipped < limit && Date.now() - started <= budget;

  // Что отправлять: сначала то, что только что отгрузили (ради этого нас и разбудили), потом остальное.
  const orderIds = Array.from(new Set(shipments.map((s) => s.orderId)));
  if (opts.orderId && orderIds.includes(opts.orderId)) orderIds.sort((a, b) => (a === opts.orderId ? -1 : b === opts.orderId ? 1 : 0));
  const todo: { order: OrderWithItems; own: Shipment[]; mine: WaybillRow[]; send: string[] }[] = [];
  for (const orderId of orderIds) {
    const order = orders.get(orderId);
    if (!order || waybillOrderRefusal(order)) continue;
    const own = shipments.filter((s) => s.orderId === orderId);
    const mine = waybills.filter((w) => w.orderId === orderId);
    const plan = planWaybill({ order, shipments: own, waybills: mine, mode: "auto", since: auto.since, now });
    if (!plan) continue;
    if ("wait" in plan) result.waiting += 1;
    else todo.push({ order, own, mine, send: plan.send });
  }
  const stuck = waybills.filter((w) => w.doc && stuckWaybillAction(w, false, now));

  // К чему вернуться (`waybillRedo`): не отправленные из-за номера или списка «не писать» и отправленные через номер
  // менеджера, который отключён от WhatsApp. Что можно, отсеиваем без чтения таблицы: клиенты уже прочитаны первым
  // пакетом, состояние номера — один запрос к Green API на номер за проход.
  const lineState: LineStates = new Map();
  const clientsNow = await listClients();
  const hasPhone = (order: OrderWithItems) => {
    const c = clientsNow.find((x) => x.clientId === order.clientId);
    return !!(waPhone(order.clientPhone) || waPhone(c?.phone) || waPhone(c?.messenger));
  };
  const redoSkipped: (WaybillRow & { rowNumber?: number })[] = [];
  let redoDead: (WaybillRow & { rowNumber?: number })[] = [];
  for (const w of waybills) {
    if (!w.doc) continue;
    const kind = waybillRedo(w, now);
    if (!kind) continue;
    const order = orders.get(w.orderId);
    if (!order || waybillOrderRefusal(order)) continue;
    if (kind === "skipped") {
      // Без мобильного номера слать по-прежнему некуда — строку не берём (и переписку ради неё не читаем).
      if (hasPhone(order)) redoSkipped.push(w);
    } else if ((await lineNow(w.line, lineState)).health === "down") redoDead.push(w);
  }
  if (redoDead.length > 0) {
    // Отметка о доставке есть — накладная дошла, пока номер ещё работал; повторять нельзя. Статусы не прочитались —
    // не повторяем вовсе: «не знаю» не должно превращаться во вторую накладную клиенту (грабли 1.14).
    try {
      const delivery = deliveryByMessage(await listWaStatuses());
      redoDead = redoDead.filter((w) => {
        const d = w.messageId ? delivery.get(w.messageId) : undefined;
        return !d || d.status === "error";
      });
    } catch {
      redoDead = [];
    }
  }
  if (todo.length === 0 && stuck.length === 0 && redoSkipped.length === 0 && redoDead.length === 0) return result;

  // Второй пакет — переписка и клиенты: только когда есть что отправлять, и до первой записи.
  const ctx = await loadCtx(map, lineState);
  for (const job of todo) {
    if (!canSend()) {
      result.waiting += 1;
      continue;
    }
    try {
      const out = await issueWaybill({ order: job.order, shipments: job.own, shipmentIds: job.send, waybills: job.mine, mode: "auto", byEmail: "auto", ctx });
      if (out.status === "sent") result.sent += 1;
      else if (out.status === "failed") result.failed += 1;
      else result.skipped += 1;
      result.notes.push(`№ ${out.number}: ${out.status}${out.note ? ` — ${out.note}` : ""}`);
      if (out.status === "failed" || (out.status === "skipped" && out.note.startsWith(WAYBILL_SKIP_NO_PHONE))) await tellManager(job.order, out, ctx);
    } catch (err) {
      // Строка могла остаться «отправляется» — её разберёт следующий проход (`healStuckWaybills`).
      result.failed += 1;
      result.notes.push(`${job.order.orderId.slice(-5)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  // Вернуться к неотправленным и к ушедшим в отключённый номер — в тот же предел отправок за проход.
  for (const w of [...redoSkipped, ...redoDead]) {
    if (!canSend()) {
      result.waiting += 1;
      continue;
    }
    const order = orders.get(w.orderId)!;
    const dead = w.status === "sent";
    try {
      const client = ctx.clients.find((c) => c.clientId === order.clientId) ?? null;
      const to = waybillRecipient({ order, client, staffKeys: ctx.staffKeys, mode: "auto" });
      if ("skip" in to) continue;
      // Строку сначала ЗАНИМАЕМ: склад отгружает заявку за заявкой, каждая отгрузка будит свой проход, и два прохода
      // увидели бы одну и ту же строку — клиент получил бы две накладные. Пишем в пометку свой знак, ждём, перечитываем:
      // знак наш — отправляем, чужой — строку взял другой проход. Пометка пишется ДО отправки и остаётся, если отправка
      // оборвётся: «отправлена повторно» больше не повторяется, «повтор после обрыва» разберёт правило застрявших.
      const mark = dead ? `${WAYBILL_RESEND_NOTE}: номер менеджера был отключён от WhatsApp` : "";
      const sign = `[${Math.random().toString(36).slice(2, 10)}]`;
      if (!(await setWaybill(w, dead ? { Note: `${mark} ${sign}` } : { Status: "sending", Note: `${WAYBILL_RETRY_NOTE} ${sign}`, Phone: to.phone }))) continue;
      await sleep(1200);
      const mine = (await listWaybillsStrict()).find((x) => x.waybillId === w.waybillId);
      if (!mine || !mine.note.includes(sign)) continue;
      const out = await deliverWaybill({ waybillId: w.waybillId, doc: w.doc, phone: to.phone, rowNumber: w.rowNumber }, order, "auto", ctx, mark);
      if (out.status === "sent") result.sent += 1;
      else {
        result.failed += 1;
        await tellManager(order, out, ctx);
      }
      result.notes.push(`№ ${out.number}: ${out.status} (${dead ? "повторно — прежний номер отключён" : "номер появился"})${out.status === "sent" ? "" : ` — ${out.note}`}`);
    } catch (err) {
      result.failed += 1;
      result.notes.push(`${order.orderId.slice(-5)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  // У застрявших — своя одна отправка за проход сверх предела: в бойкий час новые отгрузки не должны отодвигать
  // оборванную накладную бесконечно.
  let healed = 0;
  const canHeal = () => healed++ < 1 && Date.now() - started <= budget + 5000;
  await healStuckWaybills(stuck, orders, result, canHeal, ctx).catch((err) => {
    result.notes.push(`застрявшие: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
  });
  return result;
}

/**
 * Накладная клиенту не ушла — менеджер заявки узнаёт об этом сразу, а не от клиента (24.11.2026, владелец: «ты обязан
 * это делать всегда»): сообщением с основного номера на номер менеджера (его подключённый номер, иначе WhatsApp из
 * карточки сотрудника). Один раз на накладную — строка после этого «не отправлена» и сама не повторяется. Не ушло и
 * это сообщение — работа не страдает: причина видна на заявке.
 */
async function tellManager(order: OrderWithItems, out: WaybillOutcome, ctx: Ctx): Promise<void> {
  try {
    const email = (order.managerEmail || "").toLowerCase();
    if (!email) return;
    const text =
      `Накладная клиенту не ушла: заявка № ${orderCode(order.orderId)}, ${order.clientName || "клиент"}. Причина: ${out.note || "не отправилась"}.\n` +
      (out.note.startsWith(WAYBILL_SKIP_NO_PHONE) ? "Впишите мобильный номер в карточку клиента или в заявку - накладная уйдёт сама." : "Отправьте её кнопкой «Отправить накладную» на заявке.") +
      `\n${siteOrigin()}/orders/${encodeURIComponent(order.orderId)}`;
    const line = ctx.managerLines.find((l) => l.managerEmail === email);
    if (line && (await notifyLineManager(line.code, text))) return;
    const phone = waPhone(ctx.users.find((u) => u.email.toLowerCase() === email)?.phone);
    const cfg = greenConfig();
    if (phone && cfg) await sendText(cfg, phone, text, { linkPreview: false });
  } catch (err) {
    console.error("waybill manager notify:", err instanceof Error ? err.message : err);
  }
}

/**
 * Кнопка «Отправить накладную» на заявке: всё отгруженное, что ещё не вошло в накладные (у зав. складом — только её
 * цветок). Не смотрит ни на час, ни на дату включения автомата.
 */
export async function sendOrderWaybill(input: { order: OrderWithItems; farm?: string | null; byEmail: string }): Promise<WaybillOutcome> {
  const { order } = input;
  forgetReads();
  // Всё нужное — одним пакетом и до первой записи (как у автомата).
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.SHIPMENTS, SHEET_TABS.WAYBILLS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.CLIENTS]).catch(() => undefined);
  const map = await settingsMap();
  const all = (await listShipments()).filter((s) => s.orderId === order.orderId);
  const farmItems = new Set(order.items.filter((i) => !input.farm || getFarmFor(i.flowerType) === input.farm).map((i) => i.itemId));
  const shipments = all.filter((s) => farmItems.has(s.itemId));
  const waybills = (await listWaybillsStrict({ fresh: false })).filter((w) => w.orderId === order.orderId);
  const plan = planWaybill({ order, shipments, waybills, mode: "manual", now: new Date() });
  if (!plan || "wait" in plan) throw new Error("Всё отгруженное по этой заявке уже есть в накладных — новую собирать не из чего");
  return issueWaybill({ order, shipments, shipmentIds: plan.send, waybills, mode: "manual", byEmail: input.byEmail, ctx: await loadCtx(map) });
}

/** «Отправить ещё раз»: тот же документ с тем же номером, получатель — по заявке и карточке, как сейчас. */
export async function resendWaybill(input: { waybill: WaybillRow; order: OrderWithItems; byEmail: string }): Promise<WaybillOutcome> {
  const { waybill, order } = input;
  if (!waybill.doc) throw new Error("У этой накладной не сохранился состав — соберите новую");
  if (waybill.status === "duplicate") throw new Error("Это повтор — отправляйте основную накладную");
  forgetReads();
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.BOT_CHATS, SHEET_TABS.CLIENTS]).catch(() => undefined);
  const ctx = await loadCtx(await settingsMap());
  // Не отмечена отправленной — сначала смотрим переписку: накладная могла уйти, а отметка не записаться
  // (`waybillSentTrace`). Тогда восстанавливаем отметку и второй раз клиенту не шлём.
  if (waybill.status !== "sent") {
    const trace = waybillSentTrace({ number: waybill.number, phone: waybill.phone, createdAt: waybill.createdAt, orderCode: waybill.doc.orderCode }, ctx.messages);
    if (trace) {
      await setWaybill(waybill, { Status: "sent", Note: "", MessageID: trace.messageId, Line: trace.line, SentAt: trace.at });
      return { status: "sent", number: waybill.number, note: "already", phone: waybill.phone };
    }
  }
  const client = ctx.clients.find((c) => c.clientId === order.clientId) ?? null;
  const to = waybillRecipient({ order, client, staffKeys: ctx.staffKeys, mode: "manual" });
  if ("skip" in to) throw new Error(`Отправить некуда: ${to.skip}`);
  return deliverWaybill({ waybillId: waybill.waybillId, doc: waybill.doc, phone: to.phone }, order, input.byEmail, ctx);
}

export { listWaybills };
