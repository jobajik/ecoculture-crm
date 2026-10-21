import { canWorkLead, cleanStage, isClosedStage, LEAD_STAGES, phoneKey, touchRefusal, type LeadStage, type TouchInput } from "./leads";
import { LEADS_LINE } from "./broadcast";
import { ROLES } from "./constants";
import type { Lead } from "./types";
import type { ChatFacts } from "./autoBroadcast";

// ---------------------------------------------------------------------------
// Доска лидов и массовые действия (21.10.2026, владелец: «переосмысли вкладку лиды — как в канбанах, чтобы можно
// было массово выделить номера, и бот их отрабатывал»). Лиды — колонками по стадиям, на карточках галочки; выделенным
// разом: написать (ИИ по переписке каждого), фото и цены, сменить стадию, передать менеджеру, отказ. «Написать» не
// шлёт из браузера по одному: собирается обычная рассылка с личным текстом каждому и идёт по правилам рассылок
// (темп, предел на день, с номера, где шла переписка) — на ответ отвечает помощник или бот. Чистые правила — здесь,
// проверка — `check-leads-bulk`.
// ---------------------------------------------------------------------------

/** Номер менеджера — «m-<почта>» (`waLines.ts`; сюда не тянем, этот файл читает и браузер). */
const isManagerLine = (line: string) => line.startsWith("m-");

/** Сколько лидов берём в одно массовое действие. ИИ пишет каждому своё — дольше, поэтому меньше. */
export const BULK_MAX = 60;
export const BULK_AI_MAX = 25;
/** Следующее касание после переноса на доске, если не назначили сами: через столько дней. */
export const BULK_NEXT_TOUCH_DAYS = 2;

/** Колонки доски: открытые стадии; закрытые (постоянный клиент, отказ) — одной свёрнутой колонкой. */
export const BOARD_STAGES = LEAD_STAGES.filter((s) => !isClosedStage(s.key)).map((s) => s.key) as LeadStage[];

export type BulkMode = "ai" | "offer" | "text";
export const BULK_MODE_LABELS: Record<BulkMode, string> = {
  ai: "Написать (ИИ)",
  offer: "Фото и цены",
  text: "Свой текст",
};

/** С какого номера писать лиду: где шла переписка; не было — номер Земфиры для её лидов, свой номер менеджера, основной. */
export function pickSendLine(input: {
  facts: ChatFacts | undefined;
  lead: Pick<Lead, "origin" | "managerEmail">;
  role: string | null | undefined;
  managerLines: Map<string, string>;
  lineOk: (line: string) => boolean;
}): string {
  if (input.facts?.line !== undefined && input.facts && input.lineOk(input.facts.line)) return input.facts.line;
  if (input.role === ROLES.LEADGEN && input.lineOk(LEADS_LINE)) return LEADS_LINE;
  const own = input.managerLines.get((input.lead.managerEmail || "").toLowerCase());
  if (own && input.lineOk(own)) return own;
  if (input.lead.origin === "ads" && input.lineOk(LEADS_LINE)) return LEADS_LINE;
  return input.lineOk("") ? "" : "none";
}

export interface BulkSendContext {
  staff: Set<string>;
  optedOut: Set<string>;
  lineOk: (line: string) => boolean;
}

/** Почему этому лиду писать нельзя; пусто — можно. */
export function bulkSendRefusal(lead: Pick<Lead, "phone" | "stage">, phone: string, line: string, ctx: BulkSendContext): string {
  const key = phoneKey(phone);
  if (!phone || !key) return "нет мобильного номера";
  if (ctx.staff.has(key)) return "это наш сотрудник";
  if (ctx.optedOut.has(key)) return "отписался от рассылок";
  if (isClosedStage(cleanStage(lead.stage))) return "лид закрыт";
  if (line === "none" || !ctx.lineOk(line)) return "номер для отправки не подключён";
  return "";
}

/** Подпись номера для названия рассылки; имя менеджера — уже в родительном падеже («Ильяса»). */
export function lineTitle(line: string, managerGenitive: string): string {
  if (line === LEADS_LINE) return "номер Земфиры";
  if (isManagerLine(line)) return managerGenitive ? `номер ${managerGenitive}` : "номер менеджера";
  return "рабочий номер";
}

/** Задание ИИ для массового «Написать»: по переписке — одно короткое сообщение с предложением. */
export const BULK_AI_TASK =
  "Напиши клиенту ОДНО короткое сообщение, чтобы напомнить о себе и продвинуть к заказу: по переписке предложи одну-две подходящие позиции с ценой и задай один вопрос. 2–3 предложения. Начни с приветствия — прошло время. Не обещай, что оформишь или выставишь счёт сам.";

export interface BulkStageInput {
  stage: string;
  lostReason: string;
  nextTouchAt: string;
  comment: string;
}

export interface BulkTouchPlan {
  leadId: string;
  input: TouchInput;
}

/**
 * Массовая смена стадии / отказ: по лиду — касание «Другое» с комментарием и правка строки; у кого нельзя —
 * причина словами. Те же правила, что у одиночного касания (`touchRefusal`), ни одного исключения.
 */
export function planBulkStage(
  leads: Lead[],
  input: BulkStageInput,
  who: { email: string; role: string | null | undefined },
  today: string,
  adsTouchesBefore: (lead: Lead) => number,
  addDays: (day: string, n: number) => string
): { plan: BulkTouchPlan[]; refused: { lead: Lead; why: string }[] } {
  const plan: BulkTouchPlan[] = [];
  const refused: { lead: Lead; why: string }[] = [];
  const stage = (input.stage || "").trim();
  const nextTouchAt = (input.nextTouchAt || "").trim() || addDays(today, BULK_NEXT_TOUCH_DAYS);
  const comment = (input.comment || "").trim() || (stage === "lost" ? `Отказ: ${(input.lostReason || "").trim()}` : "Перенесён на доске лидов");
  for (const lead of leads) {
    if (!canWorkLead(who.role, who.email, lead)) {
      refused.push({ lead, why: lead.managerEmail ? "лид другого менеджера" : "ничей — сначала возьмите себе" });
      continue;
    }
    if (cleanStage(lead.stage) === stage && stage !== "lost") {
      refused.push({ lead, why: "уже на этой стадии" });
      continue;
    }
    const touch: TouchInput = { channel: "Другое", comment, stage, nextTouchAt, lostReason: stage === "lost" ? (input.lostReason || "").trim() : "" };
    const why = touchRefusal(touch, lead, today, adsTouchesBefore(lead));
    if (why) {
      refused.push({ lead, why });
      continue;
    }
    plan.push({ leadId: lead.leadId, input: touch });
  }
  return { plan, refused };
}

/** Короткое имя лида для отчёта о массовом действии. */
export const bulkName = (lead: Pick<Lead, "name" | "phone">) => `${lead.name || "без имени"}${phoneKey(lead.phone) ? ` (…${phoneKey(lead.phone).slice(-4)})` : ""}`;
