import { forgetReads, prefetchTables, SHEET_TABS } from "./sheets";
import { localDayKey } from "./timezone";
import { listOrdersWithItems } from "./repo/orders";
import { listShipments } from "./repo/shipments";
import { listClients } from "./repo/clients";
import { listUsers } from "./repo/users";
import { optedOutKeys, settingsMap } from "./repo/broadcasts";
import { saveSettings } from "./repo/settings";
import { appendWaMessages, listWaMessages } from "./repo/talks";
import { appendAssistantLog, lineConfig, listWaLines } from "./repo/waLines";
import { createWaybill, listWaybills, listWaybillsStrict, updateWaybill } from "./repo/waybills";
import { ourPhoneKeys } from "./lineNotify";
import { GreenError, sendFileByUrl } from "./greenApi";
import { publicWaybillUrl } from "./waFileSign";
import { phoneKey } from "./leads";
import { getFarmFor } from "./constants";
import { siteOrigin } from "./waybillKick";
import {
  WAYBILL_LAST_RUN,
  WAYBILL_RETRY_NOTE,
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
  waybillSentTrace,
  type WaybillDoc,
  type WaybillRow,
} from "./waybill";
import type { OrderWithItems, Shipment } from "./types";

/**
 * Накладная клиенту: собрать, отправить, записать (правила — `waybill.ts`).
 *
 * Порядок один и для автомата, и для кнопки на заявке: строка в `Waybills` заводится ДО отправки и занимает за собой
 * строки журнала отгрузок (второй проход ту же отгрузку не возьмёт), затем файл уходит клиенту ссылкой, затем в строку
 * пишется итог. Отправка не удалась — строка остаётся «не отправлена» с причиной; сама программа её не повторяет
 * (повторять молча — значит однажды прислать клиенту три накладные подряд), повторяет человек кнопкой на заявке.
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

/**
 * Записать итог в строку накладной — с повторами. Одна неудачная запись (таблица не ответила) в первый же день оставила
 * отправленную накладную в «отправляется»; итог отправки терять нельзя, поэтому три попытки с паузами. Не вышло —
 * false: строку позже разберёт проход по следу в переписке (`healStuckWaybills`).
 */
async function setWaybill(waybillId: string, changes: Parameters<typeof updateWaybill>[1]): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      if (await updateWaybill(waybillId, changes)) return true;
    } catch {
      /* ниже — пауза и ещё попытка */
    }
    await sleep(1500 * (i + 1));
  }
  return false;
}

/**
 * Отправить готовую строку накладной клиенту. Пробует номера по порядку (`waybillLineOrder`), пишет итог в строку.
 * После того как сообщение ушло, функция НЕ бросает ошибок: иначе вызывающий принял бы отправленное за неотправленное.
 */
export async function deliverWaybill(row: Pick<WaybillRow, "waybillId" | "doc" | "phone">, order: Pick<OrderWithItems, "managerEmail">, byEmail: string): Promise<WaybillOutcome> {
  const doc = row.doc as WaybillDoc;
  const done = async (status: "sent" | "failed", note: string, extra: Partial<Record<"MessageID" | "Line" | "SentAt", string>> = {}): Promise<WaybillOutcome> => {
    await setWaybill(row.waybillId, { Status: status, Note: note.slice(0, 300), ByEmail: byEmail, Phone: row.phone, ...extra });
    return { status, number: doc.number, note, phone: row.phone };
  };
  const fileName = waybillFileName(doc);
  const url = publicWaybillUrl(siteOrigin(), row.waybillId, fileName);
  // Сначала открываем файл сами: убеждаемся, что он собирается (иначе клиенту уйдёт подпись без накладной), и
  // прогреваем кэш — Green API скачает его без ожидания.
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return done("failed", `файл накладной не собрался (ответ ${res.status})`);
  } catch {
    return done("failed", "файл накладной не собрался — сайт не ответил");
  }

  const [messages, lines] = await Promise.all([listWaMessages({ lines: "all" }), listWaLines()]);
  const key = phoneKey(row.phone);
  const chatLines = messages
    .filter((m) => phoneKey(m.phone) === key)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((m) => m.line || "");
  const managerLine = lines.find((l) => l.active && l.managerEmail.toLowerCase() === (order.managerEmail || "").toLowerCase())?.code;
  const caption = waybillCaption(doc);
  let lastError = "ни один номер WhatsApp не подключён";
  for (const code of waybillLineOrder({ chatLines: Array.from(new Set(chatLines)), managerLine: managerLine ?? "" })) {
    const cfg = await lineConfig(code);
    if (!cfg) continue;
    try {
      const id = await sendFileByUrl(cfg, row.phone, url, fileName, caption);
      const now = new Date().toISOString();
      // В переписку и журнал — как любое сообщение из CRM: бот и помощник видят, что накладная ушла, и не считают её
      // ответом менеджера.
      await appendWaMessages([
        { messageId: id, at: now, chatId: `${row.phone}@c.us`, phone: row.phone, direction: "out", type: waybillIsPdf(doc) ? "document" : "image", text: `[накладная № ${doc.number}] ${caption}`, mediaUrl: "", senderName: "", source: "crm", line: code },
      ]).catch(() => undefined);
      await appendAssistantLog([{ at: now, line: code, phone: row.phone, kind: "crm", messageId: id, text: caption, note: `накладная № ${doc.number}`, byEmail }]).catch(() => undefined);
      return done("sent", "", { MessageID: id, Line: code || "main", SentAt: now });
    } catch (err) {
      lastError = err instanceof GreenError || err instanceof Error ? err.message : String(err);
    }
  }
  return done("failed", lastError);
}

interface Ctx {
  clients: Awaited<ReturnType<typeof listClients>>;
  users: Awaited<ReturnType<typeof listUsers>>;
  staffKeys: Set<string>;
  optedOut: Set<string>;
}

async function loadCtx(map: Record<string, string>): Promise<Ctx> {
  const [clients, users, staffKeys, optedOut] = await Promise.all([listClients(), listUsers(), ourPhoneKeys(map), optedOutKeys()]);
  return { clients, users, staffKeys, optedOut };
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
  const to = waybillRecipient({ order, client, staffKeys: ctx.staffKeys, optedOut: ctx.optedOut, mode: input.mode });
  const skip = "skip" in to ? to.skip : "";
  const phone = "skip" in to ? "" : to.phone;
  const row = await createWaybill({ orderId: order.orderId, shipmentIds: input.shipmentIds, doc, phone, status: skip ? "skipped" : "sending", note: skip, byEmail: input.byEmail });
  await sleep(1200);
  // Кто раньше — сравниваем по тому, что ЛЕЖИТ В ТАБЛИЦЕ у обеих строк (своё время тоже перечитываем): таблица может
  // вернуть дату не так, как мы её записали, и сравнение «моя из памяти против чужой из таблицы» дало бы двум проходам
  // разные ответы. Строка, которую другой проход уже довёл до конца, старше всегда.
  const fresh = await listWaybillsStrict();
  const myAt = fresh.find((w) => w.waybillId === row.waybillId)?.createdAt || row.createdAt;
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
    await updateWaybill(row.waybillId, { Status: "duplicate", Note: `та же отгрузка уже в накладной № ${rival.number}` });
    return { status: "duplicate", number: doc.number, note: `уже в накладной № ${rival.number}`, phone };
  }
  if (skip) return { status: "skipped", number: doc.number, note: skip, phone: "" };
  return deliverWaybill(row, order, input.byEmail);
}

/**
 * Накладные, застрявшие в «отправляется» (`stuckWaybillAction`): есть след в переписке — «отправлена»; нет — одна
 * повторная отправка; не вышло и со второй — «не отправлена», дальше кнопка на заявке.
 */
async function healStuckWaybills(waybills: WaybillRow[], orders: Map<string, OrderWithItems>, result: WaybillRunResult, canSend: () => boolean): Promise<void> {
  const now = new Date();
  const stuck = waybills.filter((w) => w.doc && stuckWaybillAction(w, false, now));
  if (stuck.length === 0) return;
  const messages = await listWaMessages({ lines: "all" });
  for (const w of stuck) {
    const trace = waybillSentTrace({ number: w.number, phone: w.phone, createdAt: w.createdAt, orderCode: w.doc!.orderCode }, messages);
    const action = stuckWaybillAction(w, !!trace, now);
    if (action === "sent" && trace) {
      await setWaybill(w.waybillId, { Status: "sent", Note: "", MessageID: trace.messageId, Line: trace.line, SentAt: trace.at });
      result.notes.push(`№ ${w.number}: уже ушла клиенту — отметка восстановлена по переписке`);
    } else if (action === "fail") {
      await setWaybill(w.waybillId, { Status: "failed", Note: "отправка оборвалась — отправьте кнопкой на заявке" });
      result.failed += 1;
      result.notes.push(`№ ${w.number}: failed — отправка оборвалась`);
    } else if (action === "retry") {
      const order = orders.get(w.orderId);
      if (!order || waybillOrderRefusal(order) || !w.phone || !canSend()) continue;
      // Отметка о повторе пишется ДО отправки: не записалась — не шлём, иначе при новом обрыве повторяли бы без конца.
      if (!(await setWaybill(w.waybillId, { Note: WAYBILL_RETRY_NOTE }))) continue;
      const out = await deliverWaybill(w, order, "auto");
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
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.SHIPMENTS, SHEET_TABS.WAYBILLS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]).catch(() => undefined);
  const map = await settingsMap();
  const auto = waybillAuto(map);
  if (!auto.on) return { ...result, off: "автоотправка накладных выключена" };
  const now = new Date();
  if (!waybillHourOk(almatyHour(now))) return { ...result, off: "ночь — клиентам не пишем" };

  const sinceMs = Date.parse(auto.since);
  const shipments = (await listShipments()).filter((s) => Date.parse(s.createdAt) >= sinceMs);
  // Вкладку накладных читаем строго: «не прочиталась» нельзя принять за «накладных нет» — ушли бы повторы.
  const waybills = await listWaybillsStrict();
  const orders = new Map((await listOrdersWithItems()).map((o) => [o.orderId, o]));
  // Не больше трёх отправок за проход и ни одной новой после 30-й секунды: функция живёт минуту, и отправка,
  // оборванная на полпути, хуже отправки, отложенной до следующего прохода.
  const limit = opts.limit ?? 3;
  const budget = opts.budgetMs ?? 30000;
  const canSend = () => result.sent + result.failed + result.skipped < limit && Date.now() - started <= budget;
  // Сначала — то, что только что отгрузили (ради этого нас и разбудили), потом застрявшее с прошлых проходов.
  const orderIds = Array.from(new Set(shipments.map((s) => s.orderId)));
  if (opts.orderId && orderIds.includes(opts.orderId)) orderIds.sort((a, b) => (a === opts.orderId ? -1 : b === opts.orderId ? 1 : 0));
  let ctx: Ctx | null = null;

  for (const orderId of orderIds) {
    const order = orders.get(orderId);
    if (!order || waybillOrderRefusal(order)) continue;
    const own = shipments.filter((s) => s.orderId === orderId);
    const mineWaybills = waybills.filter((w) => w.orderId === orderId);
    const plan = planWaybill({ order, shipments: own, waybills: mineWaybills, mode: "auto", since: auto.since, now });
    if (!plan) continue;
    if ("wait" in plan) {
      result.waiting += 1;
      continue;
    }
    if (!canSend()) {
      result.waiting += 1;
      continue;
    }
    ctx = ctx ?? (await loadCtx(map));
    try {
      const out = await issueWaybill({ order, shipments: own, shipmentIds: plan.send, waybills: mineWaybills, mode: "auto", byEmail: "auto", ctx });
      if (out.status === "sent") result.sent += 1;
      else if (out.status === "failed") result.failed += 1;
      else result.skipped += 1;
      result.notes.push(`№ ${out.number}: ${out.status}${out.note ? ` — ${out.note}` : ""}`);
    } catch (err) {
      result.failed += 1;
      result.notes.push(`${orderId}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  // У застрявших — своя одна отправка за проход сверх предела: в бойкий час новые отгрузки не должны отодвигать
  // оборванную накладную бесконечно.
  let healed = 0;
  const canHeal = () => healed++ < 1 && Date.now() - started <= budget + 5000;
  await healStuckWaybills(waybills, orders, result, canHeal).catch((err) => {
    result.notes.push(`застрявшие: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
  });
  if (result.sent + result.failed + result.skipped > 0) {
    const stamp = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(now);
    await saveSettings({ [WAYBILL_LAST_RUN]: `${stamp} · отправлено ${result.sent}, не отправлено ${result.failed}, пропущено ${result.skipped}` }).catch(() => undefined);
  }
  return result;
}

/**
 * Кнопка «Отправить накладную» на заявке: всё отгруженное, что ещё не вошло в накладные (у зав. складом — только её
 * цветок). Не смотрит ни на час, ни на дату включения автомата.
 */
export async function sendOrderWaybill(input: { order: OrderWithItems; farm?: string | null; byEmail: string }): Promise<WaybillOutcome> {
  const { order } = input;
  forgetReads();
  const map = await settingsMap();
  const all = (await listShipments()).filter((s) => s.orderId === order.orderId);
  const farmItems = new Set(order.items.filter((i) => !input.farm || getFarmFor(i.flowerType) === input.farm).map((i) => i.itemId));
  const shipments = all.filter((s) => farmItems.has(s.itemId));
  const waybills = (await listWaybillsStrict()).filter((w) => w.orderId === order.orderId);
  const plan = planWaybill({ order, shipments, waybills, mode: "manual", now: new Date() });
  if (!plan || "wait" in plan) throw new Error("Всё отгруженное по этой заявке уже есть в накладных — новую собирать не из чего");
  return issueWaybill({ order, shipments, shipmentIds: plan.send, waybills, mode: "manual", byEmail: input.byEmail, ctx: await loadCtx(map) });
}

/** «Отправить ещё раз»: тот же документ с тем же номером, получатель — по заявке и карточке, как сейчас. */
export async function resendWaybill(input: { waybill: WaybillRow; order: OrderWithItems; byEmail: string }): Promise<WaybillOutcome> {
  const { waybill, order } = input;
  if (!waybill.doc) throw new Error("У этой накладной не сохранился состав — соберите новую");
  if (waybill.status === "duplicate") throw new Error("Это повтор — отправляйте основную накладную");
  // Не отмечена отправленной — сначала смотрим переписку: накладная могла уйти, а отметка не записаться
  // (`waybillSentTrace`). Тогда восстанавливаем отметку и второй раз клиенту не шлём.
  if (waybill.status !== "sent") {
    const trace = waybillSentTrace({ number: waybill.number, phone: waybill.phone, createdAt: waybill.createdAt, orderCode: waybill.doc.orderCode }, await listWaMessages({ lines: "all", fresh: true }));
    if (trace) {
      await setWaybill(waybill.waybillId, { Status: "sent", Note: "", MessageID: trace.messageId, Line: trace.line, SentAt: trace.at });
      return { status: "sent", number: waybill.number, note: "already", phone: waybill.phone };
    }
  }
  const map = await settingsMap();
  const ctx = await loadCtx(map);
  const client = ctx.clients.find((c) => c.clientId === order.clientId) ?? null;
  const to = waybillRecipient({ order, client, staffKeys: ctx.staffKeys, optedOut: ctx.optedOut, mode: "manual" });
  if ("skip" in to) throw new Error(`Отправить некуда: ${to.skip}`);
  return deliverWaybill({ waybillId: waybill.waybillId, doc: waybill.doc, phone: to.phone }, order, input.byEmail);
}

export { listWaybills };
