import { prefetchTables, SHEET_TABS } from "./sheets";
import { listWaMessages } from "./repo/talks";
import { listAssistantLog, listWaLines } from "./repo/waLines";
import { listOrdersWithItems } from "./repo/orders";
import { listClients } from "./repo/clients";
import { listUsers } from "./repo/users";
import { settingsMap } from "./repo/broadcasts";
import { localDayKey } from "./timezone";
import { isAckOnly } from "./broadcast";
import { isSleeping } from "./autoBroadcast";
import { isNotASale } from "./orderKind";
import { orderCode } from "./paymentStage";
import { FLOWER_TYPE_LABELS, formatGrade, ORDER_STATUSES } from "./constants";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { isAssistantOrder } from "./sellerChannel";
import { lineMorningPlanText, lineNudgeStatus, type PlanSleeping, type PlanWaiting } from "./lineSellerRules";
import { notifyLineManager, ourPhoneKeys } from "./lineNotify";
import type { WaMessage } from "./types";

/** День по Алматы со сдвигом (−1 — вчера). */
function dayShift(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Утренний план менеджеру с продающим помощником (19.10.2026, владелец: «утренний план Ильясу»). Зовёт
 * утренняя сводка в 9:00 (`/api/digest`). Пн–сб; приходит с основного номера на номер менеджера. Возвращает
 * текст по каждому номеру (`send=false` — только собрать, для `diag-line-plan.ts`).
 */
export async function lineMorningPlans(options: { send?: boolean; site?: string } = {}): Promise<{ line: string; text: string; sent: boolean }[]> {
  const now = new Date();
  const today = localDayKey(now);
  const yesterday = dayShift(today, -1);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const lines = (await listWaLines()).filter((l) => l.active && l.assistant === "sell");
  if (lines.length === 0) return [];
  if (options.send && weekday === 0) return [];
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.SETTINGS]).catch(() => undefined);
  const [messages, log, orders, clients, users, map] = await Promise.all([listWaMessages({ lines: "all" }), listAssistantLog(), listOrdersWithItems(), listClients(), listUsers(), settingsMap()]);
  const staff = await ourPhoneKeys(map);
  const site = (options.site || process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");
  const nameByPhone = new Map<string, string>();
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) nameByPhone.set(phoneKey(p), c.name);
  const out: { line: string; text: string; sent: boolean }[] = [];

  for (const line of lines) {
    const byKey = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (m.line !== line.code) continue;
      const k = phoneKey(m.phone);
      if (k && !staff.has(k)) byKey.set(k, [...(byKey.get(k) ?? []), m]);
    }
    const waiting: PlanWaiting[] = [];
    let nudgeToday = 0;
    const noon = new Date(`${today}T09:00:00Z`); // 14:00 по Алматы — «за день помощник дожмёт»
    for (const [k, list] of Array.from(byKey.entries())) {
      const chat = mergeMessages(list);
      const last = chat[chat.length - 1];
      if (!last) continue;
      if (last.direction === "in" && now.getTime() - Date.parse(last.at) < 3 * 86400000 && !isAckOnly(messageText(last))) {
        let i = chat.length - 1;
        while (i > 0 && chat[i - 1].direction === "in") i--;
        waiting.push({ name: nameByPhone.get(k) || last.senderName || "", phone: last.phone, text: messageText(last), sinceIso: chat[i].at });
      }
      const nudges = log
        .filter((r) => r.kind === "nudge" && r.line === line.code && phoneKey(r.phone) === k)
        .map((r) => ({ at: r.at, closed: !r.messageId && /^не писать/.test(r.note) }));
      if (lineNudgeStatus({ chat, nudges, now: noon, hour: 14 }).attempt > 0) nudgeToday += 1;
    }
    waiting.sort((a, b) => (a.sinceIso < b.sinceIso ? -1 : 1));

    const yLog = log.filter((r) => r.line === line.code && r.kind === "auto" && localDayKey(new Date(r.at)) === yesterday);
    const yOrders = orders
      .filter((o) => o.managerEmail.toLowerCase() === line.managerEmail && isAssistantOrder(o) && o.status !== ORDER_STATUSES.CANCELLED && localDayKey(new Date(o.createdAt)) === yesterday)
      .map((o) => ({ code: orderCode(o.orderId), amount: o.totalAmount, paid: o.paid }));

    // Клиенты менеджера, которые молчат дольше обычного: самые ценные первыми.
    const sleeping: (PlanSleeping & { value: number })[] = [];
    for (const c of clients) {
      if ((c.managerEmail || "").toLowerCase() !== line.managerEmail || c.retail || !phoneKey(c.phone)) continue;
      const mine = orders.filter((o) => o.clientId === c.clientId && o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const days = Array.from(new Set(mine.map((o) => localDayKey(new Date(o.createdAt))))).sort();
      if (!isSleeping(days, today)) continue;
      const lastOrder = mine[mine.length - 1];
      const usual = lastOrder?.items[0] ? `${FLOWER_TYPE_LABELS[lastOrder.items[0].flowerType] ?? ""} ${lastOrder.items[0].variety}, ${formatGrade(lastOrder.items[0].grade)}`.trim() : "";
      const quiet = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${days[days.length - 1]}T12:00:00Z`)) / 86400000);
      sleeping.push({ name: c.name, phone: c.phone, days: quiet, usual, value: mine.reduce((s, o) => s + o.totalAmount, 0) });
    }
    sleeping.sort((a, b) => b.value - a.value);

    const openNotes = log
      .filter((r) => r.line === line.code && r.kind === "note" && !r.doneAt && now.getTime() - Date.parse(r.at) < 3 * 86400000 && !/^заказ:/.test(r.note))
      .map((r) => `${nameByPhone.get(phoneKey(r.phone)) || `…${r.phone.slice(-4)}`}: ${r.note.replace(/^внимание:\s*/, "")}`);

    const managerName = (users.find((u) => u.email.toLowerCase() === line.managerEmail)?.name || line.label || "").split(/\s+/)[0];
    const text = lineMorningPlanText({
      managerName,
      now,
      waiting,
      yesterday: { replies: yLog.length, chats: new Set(yLog.map((r) => phoneKey(r.phone))).size, orders: yOrders },
      nudgeToday,
      sleeping,
      openNotes,
      link: `${site}/clients/chats?line=${encodeURIComponent(line.code)}`,
    });
    const sent = !!text && !!options.send && (await notifyLineManager(line.code, text));
    out.push({ line: line.code, text, sent });
  }
  return out;
}
