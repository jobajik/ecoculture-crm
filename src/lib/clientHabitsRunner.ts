/**
 * Постоянники менеджеров: пересчёт привычек по заявкам и еженедельная рассылка от имени менеджера с его номера
 * (`clientHabits.ts`). Зовётся из утренней сводки (`/api/digest`, 9:00 пн–сб) и скриптом `scripts/client-habits.ts`.
 *
 * Что делает `runClientHabits({ send })`:
 *  1. считает привычки по заявкам клиентов за 90 дней (без отменённых, без наших магазинов, регионов и Пожарки);
 *  2. переписывает вкладку `ClientHabits` (LastSentAt и Active сохраняет);
 *  3. с `send` — тем, кому сегодня пора (`habitDue`), заводит рассылку с номера их менеджера (режим «продаёт сам» или
 *     «отвечает при молчании»; номера нет — с основного, от имени менеджера) с личным текстом (`habitText`) и фото
 *     из ротации; дальше её ведёт цепочка рассылок (темп номера, статусы, СТОП). Отмечает LastSentAt.
 */
import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { listWaLines } from "./repo/waLines";
import { listWaMessages } from "./repo/talks";
import { listSellableBatches } from "./repo/sellable";
import { getCurrentPrices } from "./repo/prices";
import { createBroadcast, optedOutKeys } from "./repo/broadcasts";
import { readTable, rowToRecord, appendRows, updateRows, prefetchTables, SHEET_TABS } from "./sheets";
import { priceFor } from "./priceList";
import { phoneKey } from "./leads";
import { waPhone, BROADCAST_STATUSES } from "./broadcast";
import { chatFacts } from "./autoBroadcast";
import { ROTATION_FILE } from "./botPhotos";
import { isNotASale } from "./orderKind";
import { ORDER_STATUSES, ROLES } from "./constants";
import { localDayKey } from "./timezone";
import { kickBroadcast } from "./autoBroadcastRunner";
import { SITE } from "./broadcastSend";
import { buildHabits, habitDue, habitText, type ClientHabit, type HabitOffer, type HabitOrder } from "./clientHabits";

export interface HabitRow extends ClientHabit {
  lastSentAt: string;
  active: boolean;
  rowNumber?: number;
}

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "менеджер";

async function loadSaved(): Promise<Map<string, { rowNumber: number; lastSentAt: string; active: boolean }>> {
  const out = new Map<string, { rowNumber: number; lastSentAt: string; active: boolean }>();
  try {
    const t = await readTable(SHEET_TABS.CLIENT_HABITS, { fresh: true });
    t.rows.forEach((row, i) => {
      const r = rowToRecord(SHEET_TABS.CLIENT_HABITS, row);
      if (r.ClientID) out.set(r.ClientID, { rowNumber: t.rowNumbers[i], lastSentAt: r.LastSentAt || "", active: String(r.Active || "").trim().toUpperCase() !== "FALSE" });
    });
  } catch {
    /* вкладки ещё нет — setup-sheet */
  }
  return out;
}

export async function computeHabits(today = localDayKey()): Promise<HabitRow[]> {
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [orders, users, saved] = await Promise.all([listOrdersWithItems(), listUsers(), loadSaved()]);
  const managers = new Set(users.filter((u) => u.active && u.role === ROLES.MANAGER).map((u) => u.email));
  const src: HabitOrder[] = orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && managers.has(o.managerEmail))
    .map((o) => ({
      orderId: o.orderId,
      clientId: o.clientId,
      clientName: o.clientName,
      clientPhone: o.clientPhone,
      managerEmail: o.managerEmail,
      day: (o.createdAt || "").slice(0, 10),
      items: o.items.map((i) => ({ flowerType: i.flowerType, variety: i.variety, grade: i.grade, quantity: i.quantity, unitPrice: i.unitPrice })),
      totalAmount: o.totalAmount,
    }));
  return buildHabits(src, today).map((h) => {
    const s = saved.get(h.clientId);
    return { ...h, lastSentAt: s?.lastSentAt ?? "", active: s?.active ?? true, rowNumber: s?.rowNumber };
  });
}

function habitRecord(h: HabitRow, now: string): Record<string, unknown> {
  return {
    ClientID: h.clientId,
    ManagerEmail: h.managerEmail,
    Name: h.name,
    Phone: h.phone,
    Orders: h.orders,
    MedianDays: h.medianGapDays,
    Weekday: h.weekday,
    UsualItems: JSON.stringify(h.usual),
    AvgAmount: h.avgAmount,
    LastOrderAt: h.lastAt,
    NextExpectedAt: h.nextExpectedAt,
    LastSentAt: h.lastSentAt,
    UpdatedAt: now,
    Active: h.active ? "TRUE" : "FALSE",
  };
}

export async function saveHabits(rows: HabitRow[]): Promise<{ updated: number; added: number }> {
  const now = new Date().toISOString();
  const regular = rows.filter((h) => h.regular);
  const upd = regular.filter((h) => h.rowNumber).map((h) => ({ rowNumber: h.rowNumber!, record: habitRecord(h, now) }));
  const add = regular.filter((h) => !h.rowNumber).map((h) => habitRecord(h, now));
  if (upd.length) await updateRows(SHEET_TABS.CLIENT_HABITS, upd);
  if (add.length) await appendRows(SHEET_TABS.CLIENT_HABITS, add);
  return { updated: upd.length, added: add.length };
}

export interface HabitSendResult {
  line: string;
  manager: string;
  sent: { name: string; phone: string; text: string }[];
  skipped: { name: string; why: string }[];
  broadcastId: string;
}

/** Кому пора сегодня — по менеджерам, с текстами; с `send` — заводит рассылки и отмечает LastSentAt. */
export async function runClientHabits(opts: { send: boolean; today?: string; byEmail?: string } = { send: false }): Promise<{ habits: HabitRow[]; results: HabitSendResult[] }> {
  const today = opts.today ?? localDayKey();
  const habits = await computeHabits(today);
  await saveHabits(habits).catch(() => undefined);
  const [users, lines, messages, optout, batches, prices, orders] = await Promise.all([
    listUsers(),
    listWaLines(),
    listWaMessages({ lines: "all" }),
    optedOutKeys(),
    listSellableBatches(),
    getCurrentPrices(),
    listOrdersWithItems(),
  ]);
  const facts = chatFacts(messages);
  const nameOf = new Map(users.map((u) => [u.email, u.name]));
  const lineOf = new Map(lines.filter((l) => l.active && l.assistant !== "off").map((l) => [l.managerEmail, l.code]));
  const stockOf = (f: string, v: string, g: string) =>
    batches.filter((b) => b.flowerType === f && b.variety.toLowerCase() === v.toLowerCase() && b.grade === g).reduce((s, b) => s + b.quantityRemaining, 0);
  const results: HabitSendResult[] = [];
  const byManager = new Map<string, HabitRow[]>();
  for (const h of habits) {
    if (!h.regular || !h.active) continue;
    const list = byManager.get(h.managerEmail) ?? [];
    list.push(h);
    byManager.set(h.managerEmail, list);
  }
  const now = new Date().toISOString();
  for (const [email, list] of byManager) {
    const manager = firstName(nameOf.get(email) || email);
    const line = lineOf.get(email) ?? "";
    const res: HabitSendResult = { line, manager, sent: [], skipped: [], broadcastId: "" };
    const recipients: { phone: string; name: string; kind: string; refId: string; managerEmail: string; text: string; habit: HabitRow }[] = [];
    for (const h of list) {
      const key = phoneKey(h.phone);
      const lastOrder = orders
        .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && (o.clientId === h.clientId || phoneKey(o.clientPhone) === key))
        .map((o) => (o.createdAt || "").slice(0, 10))
        .sort()
        .pop();
      const verdict = habitDue(h, today, { lastSentAt: h.lastSentAt, lastClientMsgAt: facts.get(key)?.lastInAt, optedOut: optout.has(key), orderedSince: lastOrder });
      if (!verdict.due) {
        res.skipped.push({ name: h.name, why: verdict.why });
        continue;
      }
      const wa = waPhone(h.phone);
      if (!wa) {
        res.skipped.push({ name: h.name, why: "нет мобильного" });
        continue;
      }
      const offers: HabitOffer[] = h.usual.map((it) => ({ item: it, price: priceFor(prices, it.flowerType, it.variety, it.grade), stock: stockOf(it.flowerType, it.variety, it.grade) }));
      const text = habitText(h, manager, offers);
      recipients.push({ phone: wa, name: h.name, kind: "client", refId: h.clientId, managerEmail: email, text, habit: h });
      res.sent.push({ name: h.name, phone: wa, text });
    }
    if (recipients.length && opts.send) {
      res.broadcastId = await createBroadcast({
        createdByEmail: opts.byEmail || "habits",
        title: `Постоянным · ${manager} · ${today.slice(8, 10)}.${today.slice(5, 7)}`,
        text: recipients[0].text,
        fileId: ROTATION_FILE,
        fileName: "Фото из ротации",
        audience: `Постоянные клиенты ${manager}: их день недели, обычные позиции (${recipients.length})`,
        recipients: recipients.map(({ habit: _h, ...r }) => r),
        line,
        status: BROADCAST_STATUSES.SENDING,
      });
      const upd = recipients.filter((r) => r.habit.rowNumber).map((r) => ({ rowNumber: r.habit.rowNumber!, record: habitRecord({ ...r.habit, lastSentAt: now }, now) }));
      if (upd.length) await updateRows(SHEET_TABS.CLIENT_HABITS, upd).catch(() => undefined);
    }
    results.push(res);
  }
  if (opts.send && results.some((r) => r.broadcastId)) await kickBroadcast(SITE()).catch(() => undefined);
  return { habits, results };
}
