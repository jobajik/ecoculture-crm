import { cleanStage, isClosedStage, phoneKey, stageIndex, whatsappLink, type TouchInput } from "./leads";
import { decisionLabel, latestByLead, MIN_MESSAGES_FOR_ANALYSIS, touchPrefill, type DecisionKey } from "./talkAnalysis";
import { mergeMessages, replyStats } from "./whatsapp";
import type { Lead, LeadAnalysis, LeadTouch, WaMessage } from "./types";

// ---------------------------------------------------------------------------
// «Решения ИИ» (15.10.2026, владелец: «сделай по лидам сортировку, где от Земфиры
// сам ИИ будет определять, как дальше поступать с клиентом: отказ, перезвонить
// через 3 дня и продать; отдельную вкладку»).
//
// Разбор переписки (`talkAnalysis.ts`) теперь даёт решение: продать сейчас,
// написать позже через N дней или отказ — с причиной и готовым сообщением
// клиенту. Здесь — раскладка лидов по этим решениям и касание, которое пишется
// кнопкой «Применить». ИИ по-прежнему только ПРЕДЛАГАЕТ: стадию и касание
// записывает человек (Земфира, РОП, админ).
//
// У разборов, сделанных до решений, решение выводится из старых полей
// (`decisionOf`): отказ/стадия «отказ» → отказ, «горячий» → продать, иначе — позже.
// Чистый модуль: его зовут страница, действия и `scripts/check-leads.ts`.
// ---------------------------------------------------------------------------

export type DecisionGroup = DecisionKey | "none";

export const DECISION_GROUP_ORDER: DecisionGroup[] = ["sell", "follow_up", "lost", "none"];
export const DECISION_GROUP_LABELS: Record<DecisionGroup, string> = {
  sell: "Продать сейчас",
  follow_up: "Написать позже",
  lost: "Отказ",
  none: "Ещё не разобраны",
};

/** Через сколько дней «написать позже», если ИИ не назвал срок. */
export const DEFAULT_FOLLOW_UP_DAYS = 3;

export interface DecisionOf {
  decision: DecisionKey;
  /** Выведено из старого разбора, а не названо ИИ. */
  inferred: boolean;
  days: number;
}

export function decisionOf(
  a: Pick<LeadAnalysis, "decision" | "suggestedStage" | "lostReason" | "temperature" | "nextTouchDays">
): DecisionOf {
  const days = a.nextTouchDays == null ? DEFAULT_FOLLOW_UP_DAYS : Math.min(30, Math.max(1, Math.round(a.nextTouchDays)));
  if (a.decision === "sell") return { decision: "sell", inferred: false, days: 0 };
  if (a.decision === "lost") return { decision: "lost", inferred: false, days: 0 };
  if (a.decision === "follow_up") return { decision: "follow_up", inferred: false, days };
  if (a.suggestedStage === "lost" || a.lostReason) return { decision: "lost", inferred: true, days: 0 };
  if (a.temperature === "hot") return { decision: "sell", inferred: true, days: 0 };
  return { decision: "follow_up", inferred: true, days };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** День «написать позже»: от дня разбора + N, но не раньше сегодня. */
export function followUpDay(analysisCreatedAt: string, days: number, today: string, toDay: (iso: string) => string): string {
  const due = addDays(toDay(analysisCreatedAt) || today, days);
  return due < today ? today : due;
}

export interface DecisionRow {
  leadId: string;
  name: string;
  phone: string;
  waLink: string;
  managerEmail: string;
  stage: string;
  handedOver: boolean;
  nextTouchAt: string;
  messages: number;
  lastAt: string | null;
  /** Клиент написал последним — с этого момента. */
  waitingSince: string | null;
  group: DecisionGroup;
  /** Решение выведено из старого разбора. */
  inferred: boolean;
  /** «Написать позже»: в какой день. */
  dueDay: string;
  analysisId: string;
  analyzedAt: string;
  why: string;
  summary: string;
  needs: string;
  nextStep: string;
  lostReason: string;
  draft: string;
  temperature: string;
  /** Сообщений после разбора — решение могло устареть. */
  newMessages: number;
  /** Мало переписки, чтобы разбирать. */
  tooShort: boolean;
}

export interface DecisionBoard {
  groups: Record<DecisionGroup, DecisionRow[]>;
  /** Решение уже применено (касание после разбора, новых сообщений после него нет). */
  done: DecisionRow[];
  /** Ждут разбора: нет разбора или есть новые сообщения после него, переписки хватает. */
  toAnalyze: string[];
  closed: number;
}

/**
 * Разложить открытые лиды по решениям ИИ. `leads` — уже те, кого человек видит;
 * `toDay` — ISO → «ГГГГ-ММ-ДД» по Алматы.
 */
export function buildDecisionBoard(input: {
  leads: Lead[];
  messages: WaMessage[];
  analyses: LeadAnalysis[];
  touches: LeadTouch[];
  today: string;
  toDay: (iso: string) => string;
}): DecisionBoard {
  const { leads, messages, analyses, touches, today, toDay } = input;
  const byKey = new Map<string, WaMessage[]>();
  for (const m of messages) {
    const key = phoneKey(m.phone);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  const lastTouch = new Map<string, string>();
  for (const t of touches) {
    if ((lastTouch.get(t.leadId) ?? "") < t.createdAt) lastTouch.set(t.leadId, t.createdAt);
  }
  const latest = latestByLead(analyses);
  const groups: Record<DecisionGroup, DecisionRow[]> = { sell: [], follow_up: [], lost: [], none: [] };
  const done: DecisionRow[] = [];
  const toAnalyze: string[] = [];
  let closed = 0;

  for (const lead of leads) {
    if (isClosedStage(lead.stage)) {
      closed++;
      continue;
    }
    const key = phoneKey(lead.phone);
    const chat = key ? mergeMessages(byKey.get(key) ?? []) : [];
    const stats = replyStats(chat);
    const a = latest.get(lead.leadId);
    const since = a ? a.messagesTo || a.createdAt : "";
    const newMessages = a ? chat.filter((m) => m.at > since).length : chat.length;
    const tooShort = chat.length < MIN_MESSAGES_FOR_ANALYSIS;
    const d = a ? decisionOf(a) : null;
    const row: DecisionRow = {
      leadId: lead.leadId,
      name: lead.name,
      phone: lead.phone,
      waLink: whatsappLink(lead.phone),
      managerEmail: lead.managerEmail,
      stage: cleanStage(lead.stage),
      handedOver: !!lead.handedOverAt,
      nextTouchAt: lead.nextTouchAt,
      messages: chat.length,
      lastAt: stats.lastAt,
      waitingSince: stats.waitingSince,
      group: d ? d.decision : "none",
      inferred: d?.inferred ?? false,
      dueDay: a && d?.decision === "follow_up" ? followUpDay(a.createdAt, d.days, today, toDay) : "",
      analysisId: a?.analysisId ?? "",
      analyzedAt: a?.createdAt ?? "",
      why: a ? a.decisionWhy || a.temperatureWhy : "",
      summary: a?.summary ?? "",
      needs: a?.needs ?? "",
      nextStep: a?.nextStep ?? "",
      lostReason: a ? a.lostReason || (d?.decision === "lost" ? "Другое" : "") : "",
      draft: a?.draft ?? "",
      temperature: a?.temperature ?? "",
      newMessages,
      tooShort,
    };
    if (!tooShort && (!a || newMessages > 0)) toAnalyze.push(lead.leadId);
    // Решение применено: касание после разбора, и клиент с тех пор не писал.
    const touchedAt = lastTouch.get(lead.leadId) ?? "";
    const afterTouch = touchedAt ? chat.filter((m) => m.at > touchedAt).length : 0;
    if (a && touchedAt > a.createdAt && afterTouch === 0) {
      done.push(row);
      continue;
    }
    groups[row.group].push(row);
  }

  const byLast = (x: DecisionRow, y: DecisionRow) => {
    const a = x.lastAt ?? "";
    const b = y.lastAt ?? "";
    return a === b ? 0 : a < b ? 1 : -1;
  };
  // Продать: кто ждёт ответа — первыми (дольше ждёт — выше), дальше свежие разговоры.
  groups.sell.sort((x, y) => {
    if (!!x.waitingSince !== !!y.waitingSince) return x.waitingSince ? -1 : 1;
    if (x.waitingSince && y.waitingSince && x.waitingSince !== y.waitingSince) return x.waitingSince < y.waitingSince ? -1 : 1;
    return byLast(x, y);
  });
  groups.follow_up.sort((x, y) => (x.dueDay !== y.dueDay ? (x.dueDay < y.dueDay ? -1 : 1) : byLast(x, y)));
  groups.lost.sort(byLast);
  // Не разобраны: где переписки хватает — первыми.
  groups.none.sort((x, y) => (x.tooShort !== y.tooShort ? (x.tooShort ? 1 : -1) : byLast(x, y)));
  done.sort(byLast);
  return { groups, done, toAnalyze, closed };
}

/** Ссылка WhatsApp с готовым текстом. */
export function waLinkWithText(link: string, text: string): string {
  if (!link) return "";
  return text.trim() ? `${link}?text=${encodeURIComponent(text.trim())}` : link;
}

/**
 * Касание, которое пишет кнопка «Применить». `override` — человек выбрал другое
 * решение или другой срок. Стадию клиента без карточки не ставим (`touchPrefill`).
 */
export function decisionTouch(
  a: Pick<
    LeadAnalysis,
    "summary" | "nextStep" | "agreed" | "suggestedStage" | "nextTouchDays" | "lostReason" | "decision" | "decisionWhy" | "temperature" | "createdAt"
  >,
  lead: Pick<Lead, "stage" | "clientId">,
  today: string,
  toDay: (iso: string) => string,
  override?: { decision?: DecisionKey; days?: number }
): TouchInput {
  const base = decisionOf(a);
  const decision = override?.decision ?? base.decision;
  const days = Math.min(30, Math.max(1, Math.round(override?.days ?? (base.days || DEFAULT_FOLLOW_UP_DAYS))));
  const prefill = touchPrefill(a, lead, today);
  const head =
    decision === "follow_up"
      ? `Решение ИИ — ${decisionLabel(decision).toLowerCase()} (через ${days} дн.)`
      : `Решение ИИ — ${decisionLabel(decision).toLowerCase()}`;
  const comment = [`${head}${a.decisionWhy ? `: ${a.decisionWhy}` : ""}`, a.summary, decision !== "lost" && a.nextStep ? `Дальше: ${a.nextStep}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);
  if (decision === "lost") {
    return { channel: "WhatsApp", comment, stage: "lost", nextTouchAt: "", lostReason: a.lostReason || "Другое" };
  }
  // ИИ мог предложить стадию «отказ», а человек решил писать дальше — стадию тогда не трогаем.
  // Назад по воронке кнопка не двигает: «Прайс отправлен» не становится «Первым контактом».
  const current = cleanStage(lead.stage);
  const stage = isClosedStage(prefill.stage) || stageIndex(prefill.stage) < stageIndex(current) ? current : prefill.stage;
  const nextTouchAt =
    decision === "sell" ? today : override?.days != null ? addDays(today, days) : followUpDay(a.createdAt, days, today, toDay);
  // Переписка уже была — «Новый» после неё уже «Первый контакт».
  const finalStage = isClosedStage(stage) || stage === "new" ? "contact" : stage;
  return { channel: "WhatsApp", comment, stage: finalStage, nextTouchAt, lostReason: "" };
}
