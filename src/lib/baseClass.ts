import { phoneKey } from "./leads";
import { looksLikeRefusal } from "./clientRefusal";

// ---------------------------------------------------------------------------
// Кто есть кто в клиентской базе (26.11.2026). Владелец: «Всю клиентскую базу нам нужно классифицировать: определить,
// кто из них кто. Принадлежность к менеджерам, незаинтересованных и прочее».
//
// База лежит в трёх местах, и один человек бывает во всех трёх сразу: карточка клиента (`Clients`), лид (`Leads`) и
// переписка WhatsApp на любом из номеров (`WaMessages`). Здесь они сводятся в ОДНУ запись на человека (ключ — номер
// телефона, `phoneKey`), и каждой записи даются три ответа:
//   - кто это (`kind`): покупал у нас / карточка без заказов / лид / только переписка;
//   - в каком он состоянии (`cls`): покупает, остывает, спит, потерян — у покупавших; разговор, тёплый, молчит, не
//     тронут, отказался, не наш — у тех, кто ещё не покупал;
//   - чей он (`owner`): менеджер карточки, иначе лида, иначе хозяин номера, где шла переписка; и что с этим не так
//     (менеджер ушёл, продаёт другой, пишет другому).
// Класс один, и он выводится из фактов, а не ставится рукой: заказ, сообщение или касание меняют его сами.
//
// Модуль чистый: чтение — `scripts/diag-base-classes.ts`, проверка — `scripts/check-base-class.ts`.
// ---------------------------------------------------------------------------

export type BaseKind = "client" | "card" | "lead" | "contact";
export const BASE_KIND_LABELS: Record<BaseKind, string> = {
  client: "Покупал у нас",
  card: "Карточка без заказов",
  lead: "Лид",
  contact: "Только переписка",
};

export type BaseClass = "active" | "cooling" | "sleeping" | "lost_client" | "talking" | "warm" | "silent" | "untouched" | "refused" | "not_ours";
export const BASE_CLASSES: BaseClass[] = ["active", "cooling", "sleeping", "lost_client", "talking", "warm", "silent", "untouched", "refused", "not_ours"];
export const BASE_CLASS_LABELS: Record<BaseClass, string> = {
  active: "Покупает",
  cooling: "Остывает",
  sleeping: "Спит",
  lost_client: "Потерян",
  talking: "Идёт разговор",
  warm: "Тёплый",
  silent: "Молчит",
  untouched: "Не тронут",
  refused: "Отказался",
  not_ours: "Не наш",
};
export const BASE_CLASS_HINTS: Record<BaseClass, string> = {
  active: "заказ за последние 30 дней",
  cooling: "последний заказ 31–60 дней назад",
  sleeping: "последний заказ 61–180 дней назад",
  lost_client: "покупал, но больше полугода заказов нет",
  talking: "ещё не покупал; писал нам за последние 14 дней",
  warm: "ещё не покупал; отвечал нам или проявлял интерес, отказа не было",
  silent: "ещё не покупал; мы писали или звонили, ответа нет",
  untouched: "с ним ещё никто не работал: ни сообщения, ни звонка",
  refused: "сказал «нет»: отказ в лиде, «СТОП», отказ в переписке",
  not_ours: "не оптовик, неверный номер или закрылся",
};

/** Границы по дням с последнего заказа. 30 дней — та же граница «молчит», что в клиентской базе (`CLIENT_SLEEPING_DAYS`). */
export const ACTIVE_DAYS = 30;
export const COOLING_DAYS = 60;
export const SLEEPING_DAYS = 180;
/** «Идёт разговор» — человек сам писал нам не позже стольких дней назад. */
export const TALKING_DAYS = 14;

/** Причины отказа лида, которые значат «это не наш клиент», а не «не хочет». */
export const NOT_OURS_REASONS = ["Неверный контакт", "Не оптовик (розница)", "Закрылись"];
/** Причина «не выходит на связь» — не отказ: человек просто молчит. */
export const SILENT_REASON = "Не выходит на связь";
const NOT_OURS_OUTCOMES = ["retail", "wrong_number"];
const INTEREST_OUTCOMES = ["price_sent", "order", "callback", "seasonal"];
const WARM_STAGES = ["contact", "need", "offer", "trial"];

export type OwnerState = "ok" | "none" | "gone";
export const OWNER_STATE_LABELS: Record<OwnerState, string> = { ok: "", none: "ничей", gone: "менеджер ушёл" };

export interface BaseCard {
  clientId: string;
  name: string;
  city: string;
  phone: string;
  messenger: string;
  managerEmail: string;
  retail: string;
  active: boolean;
}
export interface BaseLead {
  leadId: string;
  name: string;
  city: string;
  phone: string;
  managerEmail: string;
  stage: string;
  lostReason: string;
  clientId: string;
  origin: string;
  campaign: string;
}
export interface BaseOrder {
  clientId: string;
  clientPhone: string;
  managerEmail: string;
  /** День оформления, «ГГГГ-ММ-ДД». */
  day: string;
  amount: number;
}
export interface BaseMessage {
  phone: string;
  at: string;
  direction: "in" | "out";
  line: string;
  text?: string;
}
export interface BaseTouch {
  leadId: string;
  outcome: string;
}

export interface BaseEntry {
  key: string;
  kind: BaseKind;
  cls: BaseClass;
  name: string;
  city: string;
  phone: string;
  /** Чей: почта менеджера или пусто. */
  owner: string;
  ownerState: OwnerState;
  /** Откуда взят хозяин: карточка, лид или номер, где шла переписка. */
  ownerFrom: "card" | "lead" | "line" | "";
  clientIds: string[];
  leadIds: string[];
  orders: number;
  revenue: number;
  lastOrderDay: string;
  /** Последние заявки оформлял не менеджер карточки — кто. */
  soldBy: string;
  /** Переписка шла на номере другого менеджера — чьём. */
  chatWith: string;
  /** Номера, на которых есть переписка: "" — основной, «leads», «m-…». */
  lines: string[];
  /** Написал последним и ждёт нашего ответа. */
  waiting: boolean;
  optOut: boolean;
  /** Карточка выключена (сняли галочку «активен»). */
  off: boolean;
  /** На один номер заведено несколько карточек или лидов. */
  duplicates: number;
  /** База обзвона (лид из загруженного файла). */
  callBase: boolean;
  fromAds: boolean;
}

export interface BaseInput {
  cards: BaseCard[];
  leads: BaseLead[];
  orders: BaseOrder[];
  messages: BaseMessage[];
  touches: BaseTouch[];
  /** Решение ИИ по лиду («lost» и т. п.), по номеру лида. */
  decisions?: Map<string, string>;
  /** Номера сотрудников и наши собственные — в базу не идут. */
  staff: Set<string>;
  optedOut: Set<string>;
  /** Кто сейчас продаёт: почты действующих менеджеров (нижний регистр). */
  sellers: Set<string>;
  /** Чей номер WhatsApp: код линии → почта менеджера. */
  lineOwner: Map<string, string>;
  today: string;
}

export interface BaseResult {
  entries: BaseEntry[];
  /** Что в базу не вошло и почему. */
  outside: { shops: number; staff: number; noPhoneCards: number; noPhoneLeads: number };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const low = (s: string) => (s || "").trim().toLowerCase();

/** Класс покупавшего — по дням с последнего заказа. */
export function buyerClass(lastOrderDay: string, today: string): BaseClass {
  const d = dayDiff(lastOrderDay, today);
  if (d <= ACTIVE_DAYS) return "active";
  if (d <= COOLING_DAYS) return "cooling";
  return d <= SLEEPING_DAYS ? "sleeping" : "lost_client";
}

interface Facts {
  hasIn: boolean;
  hasOut: boolean;
  lastInAt: string;
  lastInText: string;
  lastAt: string;
  lastDirection: "in" | "out" | "";
  lastLine: string;
  lines: Set<string>;
}

/** Класс того, кто ещё не покупал, — по лиду, касаниям и переписке. Порядок важен: «не наш» и отказ сильнее интереса. */
export function prospectClass(input: {
  leads: Pick<BaseLead, "stage" | "lostReason">[];
  outcomes: string[];
  decision: string;
  optOut: boolean;
  facts: Pick<Facts, "hasIn" | "hasOut" | "lastInAt" | "lastInText">;
  today: string;
}): BaseClass {
  const { leads, outcomes, facts } = input;
  const lost = leads.filter((l) => l.stage === "lost");
  const allLost = leads.length > 0 && lost.length === leads.length;
  const lastOutcome = outcomes[outcomes.length - 1] || "";
  if ((allLost && lost.some((l) => NOT_OURS_REASONS.includes(l.lostReason))) || NOT_OURS_OUTCOMES.includes(lastOutcome)) return "not_ours";
  const talkedRecently = !!facts.lastInAt && dayDiff(facts.lastInAt.slice(0, 10), input.today) <= TALKING_DAYS;
  const refusedInChat = looksLikeRefusal(facts.lastInText);
  if (input.optOut || refusedInChat) return "refused";
  // Отказ в лиде, после которого человек сам написал, — уже не отказ: разговор возобновился.
  if (allLost && lost.every((l) => l.lostReason !== SILENT_REASON) && !talkedRecently) return "refused";
  if (input.decision === "lost" && !talkedRecently) return "refused";
  if (talkedRecently) return "talking";
  if (facts.hasIn || outcomes.some((o) => INTEREST_OUTCOMES.includes(o)) || leads.some((l) => WARM_STAGES.includes(l.stage))) return "warm";
  if (facts.hasOut || outcomes.length > 0 || allLost) return "silent";
  return "untouched";
}

/** Свести карточки, лиды, заявки и переписки в одну запись на человека и дать каждой класс и хозяина. */
export function classifyBase(input: BaseInput): BaseResult {
  const outside = { shops: 0, staff: 0, noPhoneCards: 0, noPhoneLeads: 0 };
  const staffSeen = new Set<string>();
  interface Unit {
    key: string;
    cards: BaseCard[];
    leads: BaseLead[];
  }
  const units = new Map<string, Unit>();
  const unit = (key: string) => {
    let u = units.get(key);
    if (!u) units.set(key, (u = { key, cards: [], leads: [] }));
    return u;
  };
  const keyOfClient = new Map<string, string>();

  for (const c of input.cards) {
    if ((c.retail || "").trim()) {
      outside.shops += 1;
      continue;
    }
    const pk = phoneKey(c.phone) || phoneKey(c.messenger);
    if (pk && input.staff.has(pk)) {
      staffSeen.add(pk);
      continue;
    }
    if (!pk) outside.noPhoneCards += 1;
    const key = pk || `c:${c.clientId}`;
    unit(key).cards.push(c);
    keyOfClient.set(c.clientId, key);
  }
  for (const l of input.leads) {
    const pk = phoneKey(l.phone);
    if (pk && input.staff.has(pk)) {
      staffSeen.add(pk);
      continue;
    }
    // Лид, из которого завели карточку, — та же запись, даже если номера записаны по-разному.
    const key = (l.clientId && keyOfClient.get(l.clientId)) || pk || `l:${l.leadId}`;
    if (!pk && !(l.clientId && keyOfClient.get(l.clientId))) outside.noPhoneLeads += 1;
    unit(key).leads.push(l);
  }

  const facts = new Map<string, Facts>();
  for (const m of input.messages) {
    const k = phoneKey(m.phone);
    if (!k || !m.at) continue;
    if (input.staff.has(k)) {
      staffSeen.add(k);
      continue;
    }
    const f = facts.get(k) ?? { hasIn: false, hasOut: false, lastInAt: "", lastInText: "", lastAt: "", lastDirection: "" as const, lastLine: "", lines: new Set<string>() };
    f.lines.add(m.line || "");
    if (m.direction === "in") {
      f.hasIn = true;
      if (m.at > f.lastInAt) {
        f.lastInAt = m.at;
        f.lastInText = m.text || "";
      }
    } else f.hasOut = true;
    if (m.at > f.lastAt) {
      f.lastAt = m.at;
      f.lastDirection = m.direction;
      f.lastLine = m.line || "";
    }
    facts.set(k, f);
    if (!units.has(k)) unit(k);
  }
  outside.staff = staffSeen.size;

  const ordersOf = new Map<string, BaseOrder[]>();
  for (const o of input.orders) {
    const key = (o.clientId && keyOfClient.get(o.clientId)) || (phoneKey(o.clientPhone) && units.has(phoneKey(o.clientPhone)) ? phoneKey(o.clientPhone) : "");
    if (!key) continue;
    ordersOf.set(key, [...(ordersOf.get(key) ?? []), o]);
  }
  const outcomesOf = new Map<string, string[]>();
  for (const t of input.touches) outcomesOf.set(t.leadId, [...(outcomesOf.get(t.leadId) ?? []), t.outcome || "touch"]);

  const sellerState = (email: string): OwnerState => (!email ? "none" : input.sellers.has(low(email)) ? "ok" : "gone");
  const entries: BaseEntry[] = [];
  for (const u of Array.from(units.values())) {
    const f = facts.get(u.key) ?? { hasIn: false, hasOut: false, lastInAt: "", lastInText: "", lastAt: "", lastDirection: "" as const, lastLine: "", lines: new Set<string>() };
    const orders = (ordersOf.get(u.key) ?? []).sort((a, b) => a.day.localeCompare(b.day));
    const lastOrderDay = orders.length ? orders[orders.length - 1].day : "";
    const card = u.cards.find((c) => c.active) ?? u.cards[0];
    const lead = u.leads.find((l) => l.stage !== "lost") ?? u.leads[0];
    const kind: BaseKind = orders.length ? "client" : card ? "card" : lead ? "lead" : "contact";
    const optOut = input.optedOut.has(u.key);
    const outcomes = u.leads.flatMap((l) => outcomesOf.get(l.leadId) ?? []);
    const cls = orders.length
      ? buyerClass(lastOrderDay, input.today)
      : prospectClass({ leads: u.leads, outcomes, decision: u.leads.map((l) => input.decisions?.get(l.leadId) || "").find(Boolean) || "", optOut, facts: f, today: input.today });

    // Чей: карточка сильнее лида, лид — сильнее номера, на котором шла переписка.
    const lineEmail = low(input.lineOwner.get(f.lastLine) || "");
    const cardOwner = low(card?.managerEmail || "");
    const leadOwner = low(lead?.managerEmail || "");
    const owner = cardOwner || leadOwner || lineEmail;
    const ownerFrom = cardOwner ? "card" : leadOwner ? "lead" : lineEmail ? "line" : "";
    // Кто на самом деле продаёт: последние три заявки — у одного менеджера, и это не хозяин.
    const lastSellers = orders.slice(-3).map((o) => low(o.managerEmail)).filter(Boolean);
    const seller = lastSellers.length >= 2 && lastSellers.every((s) => s === lastSellers[0]) ? lastSellers[0] : "";
    entries.push({
      key: u.key,
      kind,
      cls,
      name: card?.name || lead?.name || "",
      city: (card?.city || lead?.city || "").trim(),
      phone: card?.phone || lead?.phone || (/^\d+$/.test(u.key) ? u.key : ""),
      owner,
      ownerState: sellerState(owner),
      ownerFrom,
      clientIds: u.cards.map((c) => c.clientId),
      leadIds: u.leads.map((l) => l.leadId),
      orders: orders.length,
      revenue: orders.reduce((s, o) => s + (o.amount || 0), 0),
      lastOrderDay,
      soldBy: seller && owner && seller !== owner && input.sellers.has(seller) ? seller : "",
      chatWith: lineEmail && owner && lineEmail !== owner ? lineEmail : "",
      lines: Array.from(f.lines),
      waiting: f.lastDirection === "in",
      optOut,
      off: u.cards.length > 0 && u.cards.every((c) => !c.active),
      duplicates: Math.max(0, u.cards.length - 1) + Math.max(0, u.leads.filter((l) => !l.clientId).length - (u.cards.length ? 0 : 1)),
      callBase: u.leads.some((l) => !!(l.campaign || "").trim()),
      fromAds: u.leads.some((l) => l.origin === "ads"),
    });
  }
  return { entries, outside };
}
