import { CLIENT_STAGES, cleanStage, isClosedStage, stageIndex, type TouchInput } from "./leads";
import type { Lead, LeadTouch } from "./types";

// ---------------------------------------------------------------------------
// Обзвон: менеджер звонит по своей базе и одним нажатием ставит итог звонка.
//
// Владелец: «загрузить клиентскую базу, дать задание менеджерам — интерфейс
// обзвона клиентов, которых я распределю между ними, и видеть, какая реакция
// была на каждом касании». Итог звонка — обычное касание лида (вкладка
// LeadTouches) с кодом итога в колонке Outcome, поэтому вся прежняя механика
// лидов (стадии, следующее касание, карточка) работает как раньше.
//
// Модуль чистый: его зовут страница, серверное действие и проверка
// `scripts/check-calls.ts`. Без googleapis — импортирует и браузер (грабли 1.8).
// ---------------------------------------------------------------------------

export type CallOutcomeKey =
  | "no_answer"
  | "callback"
  | "price_sent"
  | "order"
  | "seasonal"
  | "not_interested"
  | "other_supplier"
  | "retail"
  | "wrong_number";

/** Группа итога — для отчёта: чем закончился разговор по-крупному. */
export type OutcomeGroup = "none" | "later" | "interest" | "refused" | "notours";

export interface CallOutcome {
  key: CallOutcomeKey;
  label: string;
  group: OutcomeGroup;
  /** Нужна дата следующего звонка (и через сколько дней её подставить). */
  dateDays?: number;
  /** Закрывает лида отказом с этой причиной (`LEAD_LOST_REASONS`). */
  lostReason?: string;
}

export const CALL_OUTCOMES: CallOutcome[] = [
  { key: "no_answer", label: "Не дозвонился", group: "none" },
  { key: "callback", label: "Перезвонить", group: "later", dateDays: 1 },
  { key: "price_sent", label: "Интересно — отправил прайс", group: "interest", dateDays: 2 },
  { key: "order", label: "Договорились о заказе", group: "interest" },
  { key: "seasonal", label: "Сезонно — позвонить позже", group: "later", dateDays: 30 },
  { key: "not_interested", label: "Неинтересно", group: "refused", lostReason: "Другое" },
  { key: "other_supplier", label: "Берёт у другого поставщика", group: "refused", lostReason: "Есть поставщик" },
  { key: "retail", label: "Не оптовик (розница)", group: "notours", lostReason: "Не оптовик (розница)" },
  { key: "wrong_number", label: "Неверный номер", group: "notours", lostReason: "Неверный контакт" },
];

export const OUTCOME_GROUPS: { key: OutcomeGroup; label: string }[] = [
  { key: "interest", label: "Интерес" },
  { key: "later", label: "Позвонить позже" },
  { key: "refused", label: "Отказ" },
  { key: "notours", label: "Не наш клиент" },
  { key: "none", label: "Не дозвонились" },
];

/** Причины для «Неинтересно» — из общего списка причин отказа. */
export const NOT_INTERESTED_REASONS = ["Дорого", "Не нужен наш цветок", "Закрылись", "Другое"] as const;

/** Столько раз «не дозвонился» — и лид закрывается как «не выходит на связь». */
export const MAX_NO_ANSWER = 3;

export function outcomeOf(key: string): CallOutcome | undefined {
  return CALL_OUTCOMES.find((o) => o.key === key);
}
export function outcomeLabel(key: string): string {
  return outcomeOf(key)?.label ?? "";
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Дата по умолчанию для итога, где она нужна. */
export function defaultDateFor(key: string, today: string): string {
  const o = outcomeOf(key);
  return o?.dateDays ? addDays(today, o.dateDays) : "";
}

/** Стадия не откатывается назад: «прайс отправлен» после «пробного заказа» — всё ещё пробный. */
function raise(current: string, target: string): string {
  const cur = cleanStage(current);
  if (cur === "lost") return target;
  return stageIndex(cur) >= stageIndex(target) ? cur : target;
}

export interface CallInput {
  outcome: string;
  comment: string;
  /** Дата следующего звонка для «перезвонить», «прайс», «сезонно». */
  date: string;
  /** Причина для «неинтересно». */
  reason: string;
}

/**
 * Итог звонка → касание лида. Возвращает строку-отказ или готовое касание.
 * `attemptsBefore` — сколько раз до этого уже «не дозвонился».
 */
export function planCall(
  input: CallInput,
  lead: Pick<Lead, "stage" | "clientId">,
  attemptsBefore: number,
  today: string
): string | { touch: TouchInput; outcome: CallOutcomeKey; closed: boolean } {
  const o = outcomeOf(input.outcome);
  if (!o) return "Выберите, чем закончился звонок";
  const text = (input.comment || "").trim();
  if (text.length > 1000) return "Комментарий слишком длинный";
  const tail = text ? `: ${text}` : "";
  const stage = cleanStage(lead.stage);

  let touch: TouchInput;
  let closed = false;
  switch (o.key) {
    case "no_answer": {
      const attempt = attemptsBefore + 1;
      closed = attempt >= MAX_NO_ANSWER;
      touch = {
        channel: "Звонок",
        comment: `Не дозвонился (попытка ${attempt} из ${MAX_NO_ANSWER})${closed ? " — закрываю" : ""}${tail}`,
        stage: closed ? "lost" : stage,
        nextTouchAt: closed ? "" : addDays(today, 1),
        lostReason: closed ? "Не выходит на связь" : "",
      };
      break;
    }
    case "callback":
    case "seasonal":
    case "price_sent": {
      const date = (input.date || "").trim() || defaultDateFor(o.key, today);
      const target = o.key === "price_sent" ? "offer" : "contact";
      touch = { channel: "Звонок", comment: `${o.label}${tail}`, stage: raise(stage, target), nextTouchAt: date, lostReason: "" };
      break;
    }
    case "order": {
      if (!lead.clientId) return "Сначала заведите клиента — без карточки заявку не оформить";
      touch = {
        channel: "Звонок",
        comment: `${o.label}${tail}`,
        stage: CLIENT_STAGES.includes(stage) ? stage : "trial",
        nextTouchAt: addDays(today, 1),
        lostReason: "",
      };
      break;
    }
    case "not_interested": {
      const reason = (NOT_INTERESTED_REASONS as readonly string[]).includes(input.reason) ? input.reason : "Другое";
      touch = { channel: "Звонок", comment: `${o.label} (${reason.toLowerCase()})${tail}`, stage: "lost", nextTouchAt: "", lostReason: reason };
      closed = true;
      break;
    }
    default: {
      touch = { channel: "Звонок", comment: `${o.label}${tail}`, stage: "lost", nextTouchAt: "", lostReason: o.lostReason ?? "Другое" };
      closed = true;
    }
  }
  return { touch, outcome: o.key, closed };
}

// --- Очередь звонков менеджера ------------------------------------------------------

export interface QueueItem {
  leadId: string;
  name: string;
  phone: string;
  city: string;
  contactPerson: string;
  segment: string;
  campaign: string;
  history: string;
  note: string;
  stage: string;
  nextTouchAt: string;
  pastOrders: number;
  clientId: string;
  /** Сколько раз уже не дозвонился. */
  attempts: number;
  /** Последние касания — чтобы не спрашивать второй раз то, что уже спросили. */
  recent: { at: string; comment: string; outcome: string }[];
  /** Почему в очереди: перезвон на сегодня (или просрочен) или ещё не звонили. */
  why: "due" | "fresh";
  firstSeenAt: string;
}

export interface CallQueue {
  items: QueueItem[];
  due: number;
  fresh: number;
  /** Отложено на будущие дни — сегодня не звонить. */
  later: number;
}

export function touchesByLead(touches: LeadTouch[]): Map<string, LeadTouch[]> {
  const map = new Map<string, LeadTouch[]>();
  for (const t of touches) {
    const list = map.get(t.leadId) ?? [];
    list.push(t);
    map.set(t.leadId, list);
  }
  for (const list of Array.from(map.values())) list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return map;
}

export function noAnswerCount(list: LeadTouch[]): number {
  return list.filter((t) => t.outcome === "no_answer").length;
}

/**
 * Кому звонить сейчас. Сверху — кому обещали перезвонить сегодня или раньше
 * (самые давние первыми), потом новые: сначала бывшие покупатели (больше
 * заказов — выше), затем свежие заявки (кто написал позже — выше: он нас ещё
 * помнит). Кому перезвон назначен на будущее — в очередь не попадает.
 */
export function buildCallQueue(leads: Lead[], touches: LeadTouch[], today: string, campaign = ""): CallQueue {
  const byLead = touchesByLead(touches);
  const items: QueueItem[] = [];
  let later = 0;
  for (const l of leads) {
    if (isClosedStage(cleanStage(l.stage))) continue;
    if (campaign && l.campaign !== campaign) continue;
    const list = byLead.get(l.leadId) ?? [];
    let why: QueueItem["why"];
    if (l.nextTouchAt && l.nextTouchAt <= today) why = "due";
    else if (!l.nextTouchAt && list.length === 0) why = "fresh";
    else if (!l.nextTouchAt) why = "due";
    else {
      later += 1;
      continue;
    }
    items.push({
      leadId: l.leadId,
      name: l.name,
      phone: l.phone,
      city: l.city,
      contactPerson: l.contactPerson,
      segment: l.segment,
      campaign: l.campaign,
      history: l.history,
      note: l.note,
      stage: cleanStage(l.stage),
      nextTouchAt: l.nextTouchAt,
      pastOrders: l.pastOrders,
      clientId: l.clientId,
      attempts: noAnswerCount(list),
      recent: list.slice(0, 3).map((t) => ({ at: t.createdAt, comment: t.comment, outcome: t.outcome })),
      why,
      firstSeenAt: l.firstSeenAt,
    });
  }
  items.sort((a, b) => {
    if (a.why !== b.why) return a.why === "due" ? -1 : 1;
    if (a.why === "due") return (a.nextTouchAt || "0") < (b.nextTouchAt || "0") ? -1 : a.nextTouchAt === b.nextTouchAt ? 0 : 1;
    if (a.pastOrders !== b.pastOrders) return b.pastOrders - a.pastOrders;
    if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? 1 : -1;
    return a.name.localeCompare(b.name, "ru");
  });
  return {
    items,
    due: items.filter((i) => i.why === "due").length,
    fresh: items.filter((i) => i.why === "fresh").length,
    later,
  };
}

// --- Отчёт по обзвону ----------------------------------------------------------------

/** Две отметки одного менеджера ближе этого — звонка между ними быть не могло. */
export const FAST_MARK_SECONDS = 20;

export interface CampaignInfo {
  name: string;
  leads: number;
  createdAt: string;
}

export function listCampaigns(leads: Lead[]): CampaignInfo[] {
  const map = new Map<string, CampaignInfo>();
  for (const l of leads) {
    if (!l.campaign) continue;
    const c = map.get(l.campaign) ?? { name: l.campaign, leads: 0, createdAt: l.createdAt };
    c.leads += 1;
    if (l.createdAt > c.createdAt) c.createdAt = l.createdAt;
    map.set(l.campaign, c);
  }
  return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface CallManagerRow {
  email: string;
  name: string;
  /** Выдано в обзвон. */
  assigned: number;
  /** Позвонили хотя бы раз. */
  called: number;
  /** Ещё ни разу не звонили (и лид не закрыт). */
  untouched: number;
  /** Не закрыты: есть кому звонить. */
  open: number;
  callsToday: number;
  calls7: number;
  /** Дозвонились: хоть один итог, кроме «не дозвонился» и «неверный номер». */
  reached: number;
  byGroup: Record<OutcomeGroup, number>;
  orders: number;
  /** Отметки быстрее FAST_MARK_SECONDS после предыдущей. */
  fast: number;
  lastCallAt: string;
}

export interface CallFeedRow {
  touchId: string;
  leadId: string;
  leadName: string;
  at: string;
  managerEmail: string;
  managerName: string;
  outcome: string;
  comment: string;
  fast: boolean;
}

export interface CallReport {
  campaign: string;
  leads: number;
  assigned: number;
  unassigned: number;
  called: number;
  untouched: number;
  reached: number;
  callsToday: number;
  /** Итог по каждому клиенту — по ПОСЛЕДНЕМУ звонку. */
  byOutcome: { key: string; label: string; group: OutcomeGroup; count: number }[];
  byGroup: Record<OutcomeGroup, number>;
  managers: CallManagerRow[];
  /** У кого есть кому звонить, но сегодня не было ни одного звонка. */
  silentToday: string[];
  feed: CallFeedRow[];
}

const emptyGroups = (): Record<OutcomeGroup, number> => ({ none: 0, later: 0, interest: 0, refused: 0, notours: 0 });
const isReach = (key: string) => !!key && key !== "no_answer" && key !== "wrong_number";

export function buildCallReport(input: {
  leads: Lead[];
  touches: LeadTouch[];
  campaign: string;
  today: string;
  nameByEmail: Map<string, string>;
  /** Кто вообще звонит: активные менеджеры (у кого ничего нет — строкой с нулями). */
  sellers?: string[];
  feedLimit?: number;
}): CallReport {
  const { campaign, today, nameByEmail } = input;
  const scope = input.leads.filter((l) => (campaign ? l.campaign === campaign : !!l.campaign));
  const ids = new Set(scope.map((l) => l.leadId));
  const leadName = new Map(scope.map((l) => [l.leadId, l.name]));
  const calls = input.touches.filter((t) => ids.has(t.leadId) && !!t.outcome);
  const byLead = touchesByLead(calls);
  const weekAgo = addDays(today, -6);
  const day = (iso: string) => (iso || "").slice(0, 10);

  // Быстрые отметки: по каждому менеджеру по порядку времени.
  const fastIds = new Set<string>();
  const byManager = new Map<string, LeadTouch[]>();
  for (const t of calls) {
    const list = byManager.get(t.managerEmail) ?? [];
    list.push(t);
    byManager.set(t.managerEmail, list);
  }
  for (const list of Array.from(byManager.values())) {
    list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      const gap = (new Date(list[i].createdAt).getTime() - new Date(list[i - 1].createdAt).getTime()) / 1000;
      if (gap >= 0 && gap < FAST_MARK_SECONDS) fastIds.add(list[i].touchId);
    }
  }

  const managers = new Map<string, CallManagerRow>();
  const mgr = (email: string) => {
    if (!managers.has(email)) {
      managers.set(email, {
        email,
        name: nameByEmail.get(email) ?? email,
        assigned: 0,
        called: 0,
        untouched: 0,
        open: 0,
        callsToday: 0,
        calls7: 0,
        reached: 0,
        byGroup: emptyGroups(),
        orders: 0,
        fast: 0,
        lastCallAt: "",
      });
    }
    return managers.get(email)!;
  };
  for (const e of input.sellers ?? []) mgr(e);

  const outcomeCount = new Map<string, number>();
  const groups = emptyGroups();
  let called = 0;
  let untouched = 0;
  let reached = 0;
  for (const l of scope) {
    const list = byLead.get(l.leadId) ?? [];
    const m = l.managerEmail ? mgr(l.managerEmail) : null;
    if (m) m.assigned += 1;
    if (m && !isClosedStage(cleanStage(l.stage))) m.open += 1;
    if (list.length === 0) {
      if (!isClosedStage(cleanStage(l.stage))) {
        untouched += 1;
        if (m) m.untouched += 1;
      }
      continue;
    }
    called += 1;
    const last = list[0].outcome;
    outcomeCount.set(last, (outcomeCount.get(last) ?? 0) + 1);
    const g = outcomeOf(last)?.group ?? "none";
    groups[g] += 1;
    const wasReached = list.some((t) => isReach(t.outcome));
    if (wasReached) reached += 1;
    if (m) {
      m.called += 1;
      m.byGroup[g] += 1;
      if (wasReached) m.reached += 1;
      if (list.some((t) => t.outcome === "order")) m.orders += 1;
    }
  }
  for (const t of calls) {
    const m = mgr(t.managerEmail);
    if (day(t.createdAt) === today) m.callsToday += 1;
    if (day(t.createdAt) >= weekAgo) m.calls7 += 1;
    if (fastIds.has(t.touchId)) m.fast += 1;
    if (t.createdAt > m.lastCallAt) m.lastCallAt = t.createdAt;
  }

  const feed = [...calls]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, input.feedLimit ?? 400)
    .map((t) => ({
      touchId: t.touchId,
      leadId: t.leadId,
      leadName: leadName.get(t.leadId) ?? t.leadId,
      at: t.createdAt,
      managerEmail: t.managerEmail,
      managerName: nameByEmail.get(t.managerEmail) ?? t.managerEmail,
      outcome: t.outcome,
      comment: t.comment,
      fast: fastIds.has(t.touchId),
    }));

  const rows = Array.from(managers.values()).sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name, "ru"));
  return {
    campaign,
    leads: scope.length,
    assigned: scope.filter((l) => !!l.managerEmail).length,
    unassigned: scope.filter((l) => !l.managerEmail && !isClosedStage(cleanStage(l.stage))).length,
    called,
    untouched,
    reached,
    callsToday: calls.filter((t) => day(t.createdAt) === today).length,
    byOutcome: CALL_OUTCOMES.map((o) => ({ key: o.key, label: o.label, group: o.group, count: outcomeCount.get(o.key) ?? 0 })),
    byGroup: groups,
    managers: rows,
    silentToday: rows.filter((m) => m.open > 0 && m.callsToday === 0).map((m) => m.name),
    feed,
  };
}
