import { prefetchTables, SHEET_TABS } from "./sheets";
import { listClients } from "./repo/clients";
import { listLeads, listLeadTouches } from "./repo/leads";
import { listOrdersWithItems } from "./repo/orders";
import { listLeadAnalyses, listWaMessages } from "./repo/talks";
import { listUsers } from "./repo/users";
import { listWaLines } from "./repo/waLines";
import { optedOutKeys, settingsMap } from "./repo/broadcasts";
import { ourPhoneKeys } from "./lineNotify";
import { latestByLead } from "./talkAnalysis";
import { isNotASale } from "./orderKind";
import { ORDER_STATUSES, ROLES } from "./constants";
import { LEADS_LINE } from "./broadcast";
import { localDayKey } from "./timezone";
import { messageText } from "./whatsapp";
import { classifyBase, pickTaker, poolTalkers, type BaseEntry, type BaseResult, type PoolTaker } from "./baseClass";
import { setOwners } from "./repo/baseOwners";
import { saveSettings } from "./repo/settings";
import { greenConfig, sendText } from "./greenApi";
import { waPhone } from "./broadcast";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf } from "./managerProfile";
import type { AppUser, Client, Lead } from "./types";

// ---------------------------------------------------------------------------
// «База» — чтение (26.11.2026). Собирает карточки, лиды, заявки, касания и переписки всех номеров и отдаёт посчитанную
// базу: одна запись на человека с классом и хозяином (`baseClass.ts`). Этим пользуются страница «Клиенты → База», её
// действия, автопилот («Знакомство» людям из общего пула) и `scripts/diag-base-classes.ts`.
// ---------------------------------------------------------------------------

/** Сотрудники, которые числятся в CRM, но с клиентами не работают (решение владельца): JSON-список почт. */
export const BASE_IDLE_SETTING = "BaseIdleStaff";
/** Отклонённые переносы: JSON-список «ключ человека>почта». */
export const BASE_DECLINED_SETTING = "BaseMoveDeclined";

const SELLER_ROLES = new Set<string>([ROLES.MANAGER, ROLES.SALES_HEAD, ROLES.ADMIN, ROLES.LEADGEN, ROLES.RETAIL_ALMATY, ROLES.RETAIL_REGIONS, ROLES.OFFICE_RETAIL]);
const low = (s: string) => (s || "").trim().toLowerCase();

export function parseList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

export interface LoadedBase extends BaseResult {
  today: string;
  users: AppUser[];
  clients: Client[];
  leads: Lead[];
  /** Имя сотрудника по почте (первое слово). */
  nameOf: (email: string) => string;
  /** Чей номер WhatsApp: код линии → почта. */
  lineOwner: Map<string, string>;
  /** Подпись номера: «основной», «Земфира», имя менеджера. */
  lineName: (line: string) => string;
  /** Кому можно записывать людей (действующие менеджеры, не «простаивающие»). */
  takers: string[];
  idle: Set<string>;
  map: Record<string, string>;
}

export async function loadBase(options: { fresh?: boolean } = {}): Promise<LoadedBase> {
  await prefetchTables([SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
  const [clients, leads, touches, orders, messages, analyses, users, lines, optedOut, map] = await Promise.all([
    listClients(),
    listLeads(options.fresh ? { fresh: true } : {}),
    listLeadTouches(),
    listOrdersWithItems(),
    listWaMessages({ lines: "all" }),
    listLeadAnalyses(),
    listUsers(),
    listWaLines().catch(() => []),
    optedOutKeys(),
    settingsMap(options.fresh),
  ]);
  const today = localDayKey();
  const idle = new Set(parseList(map[BASE_IDLE_SETTING]).map(low));
  const sellers = new Set(users.filter((u) => u.active && SELLER_ROLES.has(u.role)).map((u) => low(u.email)));
  const takers = users.filter((u) => u.active && u.role === ROLES.MANAGER && !idle.has(low(u.email))).map((u) => low(u.email));
  const names = new Map(users.map((u) => [low(u.email), (u.name || u.email).trim().split(/\s+/)[0]]));
  const nameOf = (email: string) => names.get(low(email)) ?? (email ? email.split("@")[0] : "");
  const zemfira = users.find((u) => u.active && u.role === ROLES.LEADGEN);
  const lineOwner = new Map<string, string>(lines.map((l) => [l.code, low(l.managerEmail)]));
  if (zemfira) lineOwner.set(LEADS_LINE, low(zemfira.email));
  const lineName = (line: string) => (line === "" ? "основной" : line === LEADS_LINE ? nameOf(zemfira?.email || "") || "лиды" : nameOf(lineOwner.get(line) || "") || line);

  const res = classifyBase({
    cards: clients,
    leads,
    orders: orders
      .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && !(o.retail || "").trim() && o.createdAt)
      .map((o) => ({ clientId: o.clientId, clientPhone: o.clientPhone, managerEmail: o.managerEmail, day: localDayKey(new Date(o.createdAt)), amount: o.totalAmount || 0 })),
    messages: messages.map((m) => ({ phone: m.phone, at: m.at, direction: m.direction, line: m.line || "", text: m.direction === "in" ? messageText({ type: m.type || "text", text: m.text }) : "" })),
    touches: touches.map((t) => ({ leadId: t.leadId, outcome: t.outcome })),
    decisions: new Map(Array.from(latestByLead(analyses).entries()).map(([id, a]) => [id, a.decision || ""])),
    staff: await ourPhoneKeys(map),
    optedOut,
    sellers,
    idle,
    takers: new Set(takers),
    declined: new Set(parseList(map[BASE_DECLINED_SETTING])),
    lineOwner,
    today,
  });
  return { ...res, today, users, clients, leads, nameOf, lineOwner, lineName, takers, idle, map };
}

/** Чьё это видеть: владелец и РОП — всю базу, менеджер и Земфира — своих. */
export function visibleEntries(entries: BaseEntry[], user: { email: string; role: string }): BaseEntry[] {
  if (user.role === ROLES.ADMIN || user.role === ROLES.SALES_HEAD) return entries;
  const me = low(user.email);
  return entries.filter((e) => e.owner === me);
}

// --- Общий пул: ответил — уходит менеджеру -------------------------------------------------------------------

export const BASE_POOL_LAST_RUN = "BasePoolLastRun";
const SITE = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");
/** За один проход отдаём не больше стольких: если вдруг ответит сотня, менеджер не получит сто сообщений подряд. */
const POOL_PER_RUN = 10;

/**
 * Люди из общего пула, которые сами написали нам (26.11.2026, решение владельца: «кто ответил — сразу попадает к
 * менеджеру как живой разговор»): лиду ставится менеджер — тот, на чей номер человек написал, иначе по городу, иначе у
 * кого меньше разговоров (`pickTaker`), — и менеджеру уходит сообщение с основного номера. Записанного менеджера
 * проход не меняет: берёт только лидов, у которых его нет (и перепроверяет это свежим чтением перед записью).
 */
export async function assignPoolTalkers(options: { send?: boolean } = {}): Promise<{ assigned: { name: string; to: string }[]; left: number }> {
  const base = await loadBase({ fresh: true });
  const talkers = poolTalkers(base.entries);
  const profiles = parseManagerProfiles(base.map[MANAGER_PROFILES_SETTING]);
  const lined = new Set(Array.from(base.lineOwner.values()));
  const takers: PoolTaker[] = base.takers.map((email) => ({
    email,
    city: profileOf(profiles, email)?.city || "",
    hasLine: lined.has(email),
    load: base.entries.filter((e) => e.owner === email && (e.cls === "talking" || e.cls === "warm")).length,
  }));
  const assigned: { name: string; to: string }[] = [];
  const plan: { entry: BaseEntry; to: string }[] = [];
  for (const e of talkers.slice(0, POOL_PER_RUN)) {
    const to = e.moveTo || pickTaker(e.city, takers);
    if (!to) continue;
    plan.push({ entry: e, to });
    const t = takers.find((x) => x.email === to);
    if (t) t.load += 1;
  }
  if (!plan.length) return { assigned, left: talkers.length };
  if (options.send === false) return { assigned: plan.map((p) => ({ name: p.entry.name, to: base.nameOf(p.to) })), left: talkers.length - plan.length };
  await setOwners({ clients: [], leads: plan.flatMap((p) => p.entry.leadIds.map((leadId) => ({ leadId, managerEmail: p.to }))), onlyFrom: (current) => current === "" });
  const cfg = greenConfig();
  for (const p of plan) {
    assigned.push({ name: p.entry.name, to: base.nameOf(p.to) });
    const phone = waPhone(base.users.find((u) => u.email.trim().toLowerCase() === p.to)?.phone);
    if (!cfg || !phone) continue;
    const e = p.entry;
    // Человек и так пишет на номер этого менеджера — сообщать «вам передан» незачем, он его уже видит.
    if (base.lineOwner.get(e.lastInLine) === p.to) continue;
    const chat = waPhone(e.phone) ? `${SITE()}/clients/chats?line=${encodeURIComponent(e.lastInLine)}&phone=${waPhone(e.phone)}` : `${SITE()}/clients/base`;
    const text = [
      `*Вам передан человек из общей базы:* ${e.name || "без имени"}${e.city ? `, ${e.city}` : ""}.`,
      `Он написал на ${base.lineName(e.lastInLine) === "основной" ? "основной номер" : `номер: ${base.lineName(e.lastInLine)}`}${e.lastInText ? `: «${e.lastInText.slice(0, 160)}»` : ""}.`,
      `Теперь он ваш — ответьте ему. Переписка: ${chat}`,
    ].join("\n");
    await sendText(cfg, phone, text, { linkPreview: false }).catch((err) => console.error("base pool notify:", err instanceof Error ? err.message : err));
  }
  await saveSettings({ [BASE_POOL_LAST_RUN]: `${new Date().toISOString()} · отдано ${assigned.length}: ${assigned.map((a) => `${a.name || "без имени"} → ${a.to}`).join("; ")}`.slice(0, 900) }).catch(() => undefined);
  return { assigned, left: talkers.length - plan.length };
}

/** Часовой проход будит раздачу пула своей функцией (`/api/base/pool`), днём. */
export async function kickBasePool(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/base/pool?send=1`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами — проход идёт своей функцией.
  }
}
