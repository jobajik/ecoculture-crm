/**
 * Аналитика рассылок постоянникам (09.11.2026, владелец: «очень важно делать это на автомате и вести аналитику по
 * таким рассылкам»). Рассылки узнаются по `Auto` = «habits» (`clientHabitsRunner.HABIT_AUTO`), режим — по заголовку
 * (`habitModeOf`): в день клиента / по просьбе менеджера / сам (молчат дольше обычного). По каждому получателю:
 * отправлено, доставлено, прочитано, ответил (входящее после отправки), заказал за `ORDER_WINDOW_DAYS` после отправки
 * (заявка по карточке или телефону) и на какую сумму; текст был словами менеджера или шаблоном (`SourceNote`).
 * Чистые функции, проверка — `scripts/check-client-habits.ts`.
 */
import { phoneKey } from "./leads";
import { ORDER_STATUSES } from "./constants";
import { recipientViews, type RecipientRow, type RecipientView } from "./broadcast";
import type { Broadcast } from "./repo/broadcasts";
import type { OrderWithItems, WaMessage } from "./types";

export const HABIT_AUTO_TAG = "habits";
/** Заявка через столько дней после сообщения ещё считается его результатом. */
export const ORDER_WINDOW_DAYS = 3;

export type HabitMode = "weekly" | "command" | "overdue";
export const HABIT_MODE_LABELS: Record<HabitMode, string> = { weekly: "в его день", command: "по просьбе менеджера", overdue: "сам: молчат дольше обычного" };

export function habitModeOfTitle(title: string): HabitMode | null {
  if (!/^Постоянным · /.test(title || "")) return null;
  if (title.includes("· молчат ·")) return "overdue";
  if (title.includes("· по просьбе ·")) return "command";
  return "weekly";
}

export interface HabitStat {
  key: string;
  manager: string;
  managerEmail: string;
  mode: HabitMode | "all";
  broadcasts: number;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  ordered: number;
  revenue: number;
  queued: number;
  errors: number;
}

export interface HabitSendRow {
  broadcastId: string;
  title: string;
  mode: HabitMode;
  manager: string;
  managerEmail: string;
  line: string;
  day: string;
  phone: string;
  name: string;
  state: RecipientView["state"];
  sentAt: string;
  replyAt: string;
  replyText: string;
  orderId: string;
  orderAt: string;
  orderAmount: number;
  text: string;
}

const empty = (key: string, manager: string, managerEmail: string, mode: HabitStat["mode"]): HabitStat => ({
  key, manager, managerEmail, mode, broadcasts: 0, recipients: 0, sent: 0, delivered: 0, read: 0, replied: 0, ordered: 0, revenue: 0, queued: 0, errors: 0,
});

/** Рассылки постоянникам за окно дней (по дню плана), с получателями, статусами, ответами и заявками после. */
export function habitsAnalytics(input: {
  broadcasts: Broadcast[];
  recipients: RecipientRow[];
  statuses: Map<string, { status: string; error: string }>;
  messages: WaMessage[];
  orders: OrderWithItems[];
  nameOf: (email: string) => string;
  today: string;
  days?: number;
}): { rows: HabitSendRow[]; byManager: HabitStat[]; byMode: HabitStat[]; total: HabitStat } {
  const from = input.days ? new Date(Date.parse(`${input.today}T00:00:00Z`) - (input.days - 1) * 86400000).toISOString().slice(0, 10) : "";
  const bcs = input.broadcasts.filter((b) => b.auto === HABIT_AUTO_TAG && habitModeOfTitle(b.title) && (!from || (b.plannedFor || b.createdAt.slice(0, 10)) >= from));
  const bcById = new Map(bcs.map((b) => [b.broadcastId, b]));
  const rows = input.recipients.filter((r) => bcById.has(r.broadcastId));
  const views = recipientViews(rows, input.statuses, input.messages);
  const live = input.orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const out: HabitSendRow[] = [];
  for (const v of views) {
    const b = bcById.get(v.broadcastId)!;
    const mode = habitModeOfTitle(b.title)!;
    const sentAt = v.sentAt || "";
    const until = sentAt ? new Date(Date.parse(sentAt) + ORDER_WINDOW_DAYS * 86400000).toISOString() : "";
    const key = phoneKey(v.phone);
    const order = sentAt
      ? live
          .filter((o) => (o.clientId && o.clientId === v.refId) || (key && phoneKey(o.clientPhone) === key))
          .filter((o) => o.createdAt > sentAt && o.createdAt <= until)
          .sort((a, c) => (a.createdAt < c.createdAt ? -1 : 1))[0]
      : undefined;
    const email = b.createdByEmail && b.createdByEmail !== "habits" && b.createdByEmail !== "staff" ? b.createdByEmail : v.managerEmail;
    out.push({
      broadcastId: b.broadcastId,
      title: b.title,
      mode,
      manager: input.nameOf(v.managerEmail || email),
      managerEmail: v.managerEmail || email,
      line: b.line || "",
      day: b.plannedFor || b.createdAt.slice(0, 10),
      phone: v.phone,
      name: v.name,
      state: v.state,
      sentAt,
      replyAt: v.replyAt,
      replyText: v.replyText,
      orderId: order?.orderId || "",
      orderAt: order?.createdAt || "",
      orderAmount: order?.totalAmount || 0,
      text: v.text || b.text,
    });
  }
  const add = (s: HabitStat, r: HabitSendRow) => {
    s.recipients += 1;
    if (["sent", "delivered", "read", "replied"].includes(r.state)) s.sent += 1;
    if (["delivered", "read", "replied"].includes(r.state)) s.delivered += 1;
    if (["read", "replied"].includes(r.state)) s.read += 1;
    if (r.state === "replied") s.replied += 1;
    if (r.state === "queued") s.queued += 1;
    if (r.state === "error") s.errors += 1;
    if (r.orderId) {
      s.ordered += 1;
      s.revenue += r.orderAmount;
    }
  };
  const byManager = new Map<string, HabitStat>();
  const byMode = new Map<string, HabitStat>();
  const total = empty("all", "Все", "", "all");
  const bcSeen = { m: new Map<string, Set<string>>(), mode: new Map<string, Set<string>>(), all: new Set<string>() };
  for (const r of out) {
    const m = byManager.get(r.managerEmail) ?? empty(r.managerEmail, r.manager, r.managerEmail, "all");
    add(m, r);
    byManager.set(r.managerEmail, m);
    const md = byMode.get(r.mode) ?? empty(r.mode, HABIT_MODE_LABELS[r.mode], "", r.mode);
    add(md, r);
    byMode.set(r.mode, md);
    add(total, r);
    (bcSeen.m.get(r.managerEmail) ?? bcSeen.m.set(r.managerEmail, new Set()).get(r.managerEmail)!).add(r.broadcastId);
    (bcSeen.mode.get(r.mode) ?? bcSeen.mode.set(r.mode, new Set()).get(r.mode)!).add(r.broadcastId);
    bcSeen.all.add(r.broadcastId);
  }
  for (const [k, s] of byManager) s.broadcasts = bcSeen.m.get(k)?.size ?? 0;
  for (const [k, s] of byMode) s.broadcasts = bcSeen.mode.get(k)?.size ?? 0;
  total.broadcasts = bcSeen.all.size;
  return {
    rows: out.sort((a, b) => (a.sentAt || a.day) < (b.sentAt || b.day) ? 1 : -1),
    byManager: [...byManager.values()].sort((a, b) => b.sent - a.sent),
    byMode: (["weekly", "command", "overdue"] as HabitMode[]).map((m) => byMode.get(m) ?? empty(m, HABIT_MODE_LABELS[m], "", m)),
    total,
  };
}

/** Строка для утренней сводки: вчерашние рассылки постоянникам одной фразой; пусто — не было. */
export function habitsDigestLine(stats: { total: HabitStat; byManager: HabitStat[] }): string {
  const t = stats.total;
  if (!t.recipients) return "";
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "—");
  const parts = stats.byManager.filter((m) => m.sent).map((m) => `${m.manager} ${m.sent}${m.replied ? `, ответили ${m.replied}` : ""}${m.ordered ? `, заказали ${m.ordered}` : ""}`);
  return `Постоянникам: отправлено ${t.sent}, прочитали ${pct(t.read, t.sent)}, ответили ${t.replied}, заказали ${t.ordered}${t.revenue ? ` на ${Math.round(t.revenue).toLocaleString("ru-RU")} ₸` : ""}${parts.length ? ` (${parts.join("; ")})` : ""}.`;
}
