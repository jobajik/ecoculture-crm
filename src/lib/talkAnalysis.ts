import { LEAD_LOST_REASONS, LEAD_STAGES, LEAD_STAGE_KEYS, CLIENT_STAGES, cleanStage, isClosedStage, phoneKey } from "./leads";
import type { ChecklistMark, Lead, LeadAnalysis, TalkObjection, WaMessage } from "./types";
import { mergeMessages, replyStats } from "./whatsapp";

// ---------------------------------------------------------------------------
// Разбор переписки с лидом: что спрашивать у ИИ, как проверить его ответ и
// как свести разборы в отчёт РОПу.
//
// Владелец выбрал четыре вещи: кратко + следующий шаг, оценка менеджера,
// возражения и причины отказа, подсказка стадии и «горячести». Решения:
//
//  - ИИ ПРЕДЛАГАЕТ, человек решает. Стадию и касание меняет менеджер кнопкой —
//    разбор только заполняет форму. Ошибка модели не должна тихо двигать воронку;
//  - оценку в баллах считает ПРОГРАММА из чек-листа (`scoreOf`), а не модель:
//    одинаковые отметки дают одинаковый балл, и его можно объяснить по пунктам;
//  - скорость ответа — факт из времени сообщений (`replyStats`), ИИ её не считает;
//  - ответ модели проверяется как присланное из браузера (грабли 1.11):
//    незнакомая стадия, причина или вид возражения превращаются в пустое.
//
// Модуль чистый — его зовут действие, отчёт и `scripts/check-talks.ts`.
// ---------------------------------------------------------------------------

export const CHECKLIST = [
  { key: "greeting", label: "Поздоровался и представился", hint: "назвал себя и компанию" },
  { key: "needs", label: "Выяснил потребность", hint: "какой цветок, сколько, как часто, куда" },
  { key: "offer", label: "Дал предложение", hint: "прайс, цены, фото, наличие" },
  { key: "objection", label: "Отработал возражение", hint: "не бросил на «дорого» или «есть поставщик»" },
  { key: "next_step", label: "Договорился о следующем шаге", hint: "дата, заказ, звонок" },
  { key: "tone", label: "Вежливо и по делу", hint: "без грубости и пустых ответов" },
] as const;
export const CHECKLIST_KEYS = CHECKLIST.map((c) => c.key) as string[];

export const OBJECTION_KINDS = [
  { key: "price", label: "Дорого" },
  { key: "supplier", label: "Есть поставщик" },
  { key: "quality", label: "Качество" },
  { key: "assortment", label: "Нет нужного (сорт, длина)" },
  { key: "delivery", label: "Доставка" },
  { key: "payment", label: "Условия оплаты" },
  { key: "timing", label: "Не сейчас" },
  { key: "silence", label: "Пропал, не отвечает" },
  { key: "other", label: "Другое" },
] as const;
export const OBJECTION_KEYS = OBJECTION_KINDS.map((o) => o.key) as string[];
export const objectionLabel = (key: string) => OBJECTION_KINDS.find((o) => o.key === key)?.label ?? "Другое";

export const TEMPERATURES = [
  { key: "hot", label: "Горячий", hint: "готов заказать" },
  { key: "warm", label: "Тёплый", hint: "интерес есть, решение не принято" },
  { key: "cold", label: "Холодный", hint: "интереса нет или молчит" },
] as const;
export const temperatureLabel = (key: string) => TEMPERATURES.find((t) => t.key === key)?.label ?? "";

/** Меньше этого разбирать нечего: «Здравствуйте» и «добрый день» ни о чём не говорят. */
export const MIN_MESSAGES_FOR_ANALYSIS = 2;

// Длина строк и число элементов в схеме не ограничиваются: строгий режим OpenAI
// понимает не все ключевые слова и на незнакомом отказывает целиком. Длины
// обрезает `parseAnalysis`.
const S = (description: string) => ({ type: "string", description });

/** JSON-схема ответа модели. Строгий режим: все поля обязательны, лишних нет. */
export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "needs",
    "agreed",
    "next_step",
    "next_touch_in_days",
    "suggested_stage",
    "temperature",
    "temperature_why",
    "objections",
    "lost_reason",
    "checklist",
    "advice",
  ],
  properties: {
    summary: S("2–4 предложения: о чём переписка и где разговор сейчас"),
    needs: S("Что нужно клиенту: цветок, объём, длина/категория, как часто, город, сроки. Пусто, если не выяснено"),
    agreed: S("О чём договорились. Пусто, если ни о чём"),
    next_step: S("Что менеджеру сделать дальше — одно конкретное действие"),
    next_touch_in_days: { type: ["integer", "null"], description: "Через сколько дней следующее касание (0–30); null, если лид закрыт" },
    suggested_stage: { type: "string", enum: LEAD_STAGE_KEYS },
    temperature: { type: "string", enum: TEMPERATURES.map((t) => t.key) },
    temperature_why: S("Почему такая температура — по фактам из переписки"),
    objections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "quote"],
        properties: {
          kind: { type: "string", enum: OBJECTION_KEYS },
          quote: S("Слова клиента, коротко"),
        },
      },
    },
    lost_reason: { type: "string", enum: ["", ...LEAD_LOST_REASONS] },
    checklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "mark", "comment"],
        properties: {
          key: { type: "string", enum: CHECKLIST_KEYS },
          mark: { type: "string", enum: ["yes", "no", "na"] },
          comment: S("Коротко, почему так — с опорой на переписку"),
        },
      },
    },
    advice: S("Одна-две подсказки менеджеру, как продвинуть сделку"),
  },
};

export interface PromptInput {
  lead: Pick<Lead, "name" | "city" | "clientType" | "stage" | "contactPerson">;
  transcript: string;
  today: string;
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const stages = LEAD_STAGES.map((s) => `${s.key} — ${s.label} (${s.hint})`).join("; ");
  const checklist = CHECKLIST.map((c) => `${c.key} — ${c.label} (${c.hint})`).join("; ");
  const system = [
    "Ты помогаешь руководителю отдела продаж цветочного хозяйства Ecoculture (Казахстан).",
    "Хозяйство выращивает и продаёт оптом розы, хризантемы и эустому: цветочным магазинам, салонам, оптовикам.",
    "Тебе дают переписку менеджера с потенциальным клиентом (лидом) в WhatsApp. Разбери её и ответь строго по схеме.",
    "Правила:",
    "- пиши по-русски, коротко и по делу; переписка может быть на русском и казахском;",
    "- опирайся ТОЛЬКО на переписку; чего в ней нет — не придумывай, оставь поле пустым;",
    `- стадии лида: ${stages}. Предлагай стадию по фактам; trial и regular — только если клиент уже заказывал;`,
    "- lost — только если клиент прямо отказался; тогда выбери причину lost_reason, иначе оставь её пустой;",
    `- чек-лист менеджера: ${checklist}. Отметь каждый пункт ровно один раз: yes — сделал, no — должен был и не сделал, na — не к месту (например, возражений не было);`,
    "- temperature: hot — готов заказать или просит счёт/доставку; warm — интерес есть; cold — отказ или долго молчит;",
    "- next_touch_in_days: когда разумно написать снова (0 — сегодня), null — если лид закрыт.",
  ].join("\n");
  const user = [
    `Сегодня: ${input.today}.`,
    `Лид: ${input.lead.name}${input.lead.city ? `, ${input.lead.city}` : ""}${input.lead.clientType ? `, ${input.lead.clientType}` : ""}.`,
    input.lead.contactPerson ? `Контакт: ${input.lead.contactPerson}.` : "",
    `Текущая стадия в CRM: ${cleanStage(input.lead.stage)}.`,
    "",
    "Переписка (время по Алматы):",
    input.transcript,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system, user };
}

function str(v: unknown, max: number): string {
  const s = String(v ?? "").replace(/\s+\n/g, "\n").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface ParsedAnalysis {
  summary: string;
  needs: string;
  agreed: string;
  nextStep: string;
  nextTouchDays: number | null;
  suggestedStage: string;
  temperature: "hot" | "warm" | "cold" | "";
  temperatureWhy: string;
  objections: TalkObjection[];
  lostReason: string;
  checklist: ChecklistMark[];
  advice: string;
}

/** Ответ модели → проверенный разбор. Всё незнакомое превращается в пустое. */
export function parseAnalysis(raw: unknown): ParsedAnalysis {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = String(r.suggested_stage ?? "");
  const temp = String(r.temperature ?? "");
  const days = Number(r.next_touch_in_days);
  const lost = String(r.lost_reason ?? "");
  const marks = new Map<string, ChecklistMark>();
  for (const item of Array.isArray(r.checklist) ? r.checklist : []) {
    const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const key = String(it.key ?? "");
    if (!CHECKLIST_KEYS.includes(key) || marks.has(key)) continue;
    const mark = it.mark === "yes" || it.mark === "no" ? it.mark : "na";
    marks.set(key, { key, mark, comment: str(it.comment, 200) });
  }
  const objections: TalkObjection[] = [];
  for (const item of Array.isArray(r.objections) ? r.objections.slice(0, 6) : []) {
    const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const kind = OBJECTION_KEYS.includes(String(it.kind)) ? String(it.kind) : "other";
    objections.push({ kind, quote: str(it.quote, 200) });
  }
  return {
    summary: str(r.summary, 800),
    needs: str(r.needs, 600),
    agreed: str(r.agreed, 600),
    nextStep: str(r.next_step, 600),
    nextTouchDays: r.next_touch_in_days === null || !Number.isFinite(days) ? null : Math.min(30, Math.max(0, Math.round(days))),
    suggestedStage: LEAD_STAGE_KEYS.includes(stage) ? stage : "",
    temperature: temp === "hot" || temp === "warm" || temp === "cold" ? temp : "",
    temperatureWhy: str(r.temperature_why, 300),
    objections,
    lostReason: (LEAD_LOST_REASONS as readonly string[]).includes(lost) ? lost : "",
    // Порядок — наш, а не модели; пропущенный пункт — «не к месту», а не «нет».
    checklist: CHECKLIST_KEYS.map((key) => marks.get(key) ?? { key, mark: "na", comment: "" }),
    advice: str(r.advice, 400),
  };
}

/** Балл 0–100: доля «да» среди пунктов, которые были к месту. Нечего оценивать — null. */
export function scoreOf(checklist: ChecklistMark[]): number | null {
  const counted = checklist.filter((c) => c.mark === "yes" || c.mark === "no");
  if (counted.length === 0) return null;
  return Math.round((counted.filter((c) => c.mark === "yes").length / counted.length) * 100);
}

export function scoreTone(score: number | null): "good" | "warn" | "bad" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TouchPrefill {
  channel: string;
  comment: string;
  stage: string;
  nextTouchAt: string;
  lostReason: string;
}

/**
 * Разбор → заполненная форма касания. Менеджер видит её и жмёт «Записать» сам.
 * Стадию клиента («Пробный», «Постоянный») без карточки клиента не ставим — туда
 * ведёт только «Завести клиентом»; отказ без причины — «Другое».
 */
export function touchPrefill(
  a: Pick<LeadAnalysis, "summary" | "nextStep" | "agreed" | "suggestedStage" | "nextTouchDays" | "lostReason">,
  lead: Pick<Lead, "stage" | "clientId">,
  today: string
): TouchPrefill {
  let stage = a.suggestedStage && LEAD_STAGE_KEYS.includes(a.suggestedStage) ? a.suggestedStage : cleanStage(lead.stage);
  if (CLIENT_STAGES.includes(stage) && !lead.clientId) stage = cleanStage(lead.stage);
  const parts = [a.summary, a.agreed ? `Договорились: ${a.agreed}` : "", a.nextStep ? `Дальше: ${a.nextStep}` : ""];
  return {
    channel: "WhatsApp",
    comment: parts.filter(Boolean).join("\n").slice(0, 3000),
    stage,
    nextTouchAt: isClosedStage(stage) ? "" : addDays(today, a.nextTouchDays ?? 2),
    lostReason: stage === "lost" ? a.lostReason || "Другое" : "",
  };
}

/** Последний разбор каждого лида. */
export function latestByLead(analyses: LeadAnalysis[]): Map<string, LeadAnalysis> {
  const map = new Map<string, LeadAnalysis>();
  for (const a of analyses) {
    const prev = map.get(a.leadId);
    if (!prev || a.createdAt > prev.createdAt) map.set(a.leadId, a);
  }
  return map;
}

/** Сколько сообщений пришло после последнего разбора (или всего, если разбора нет). */
export function newSinceAnalysis(messages: WaMessage[], last: LeadAnalysis | undefined): number {
  if (!last) return messages.length;
  const to = last.messagesTo || last.createdAt;
  return messages.filter((m) => m.at > to).length;
}

// --- Отчёт РОПу ------------------------------------------------------------------

export interface TalkLeadInfo {
  leadId: string;
  name: string;
  managerEmail: string;
  stage: string;
  messages: number;
  lastAt: string | null;
  waitingSince: string | null;
  replyMinutes: number | null;
  analysis?: LeadAnalysis;
  newMessages: number;
}

/** Переписка лидов: сводка по каждому лиду, у которого есть телефон и сообщения. */
export function talkInfoByLead(leads: Lead[], messages: WaMessage[], analyses: LeadAnalysis[]): Map<string, TalkLeadInfo> {
  const byKey = new Map<string, WaMessage[]>();
  for (const m of messages) {
    const key = phoneKey(m.phone);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  const latest = latestByLead(analyses);
  const out = new Map<string, TalkLeadInfo>();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    const list = key ? mergeMessages(byKey.get(key) ?? []) : [];
    const analysis = latest.get(lead.leadId);
    if (list.length === 0 && !analysis) continue;
    const stats = replyStats(list);
    out.set(lead.leadId, {
      leadId: lead.leadId,
      name: lead.name,
      managerEmail: lead.managerEmail,
      stage: cleanStage(lead.stage),
      messages: list.length,
      lastAt: stats.lastAt,
      waitingSince: stats.waitingSince,
      replyMinutes: stats.replyMinutes,
      analysis,
      newMessages: newSinceAnalysis(list, analysis),
    });
  }
  return out;
}

export interface ManagerTalkRow {
  email: string;
  name: string;
  analysed: number;
  avgScore: number | null;
  /** Доля «да» по каждому пункту чек-листа среди «да»+«нет»; null — пункт ни разу не был к месту. */
  items: Record<string, number | null>;
  replyMinutes: number | null;
  waiting: number;
  hot: number;
}

export interface TalkReport {
  managers: ManagerTalkRow[];
  objections: { kind: string; label: string; count: number }[];
  hot: TalkLeadInfo[];
  waiting: TalkLeadInfo[];
  stale: TalkLeadInfo[];
  analysedTotal: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Отчёт по перепискам: берётся ПОСЛЕДНИЙ разбор каждого лида, сделанный за
 * `days` дней, — оценка менеджера по свежему разговору, а не по давнему.
 * «Ждут ответа» — последним писал клиент и прошло больше `waitMinutes`.
 */
export function buildTalkReport(
  infos: TalkLeadInfo[],
  nameByEmail: Map<string, string>,
  now: Date,
  days = 30,
  waitMinutes = 60
): TalkReport {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const waitBefore = new Date(now.getTime() - waitMinutes * 60000).toISOString();
  const byManager = new Map<string, TalkLeadInfo[]>();
  for (const info of infos) {
    const list = byManager.get(info.managerEmail) ?? [];
    list.push(info);
    byManager.set(info.managerEmail, list);
  }
  const managers: ManagerTalkRow[] = [];
  for (const [email, list] of Array.from(byManager.entries())) {
    const fresh = list.filter((i) => i.analysis && i.analysis.createdAt >= since).map((i) => i.analysis!);
    const scores = fresh.map((a) => a.score).filter((s): s is number => s !== null);
    const items: Record<string, number | null> = {};
    for (const key of CHECKLIST_KEYS) {
      const marks = fresh.flatMap((a) => a.checklist.filter((c) => c.key === key && c.mark !== "na"));
      items[key] = marks.length ? Math.round((marks.filter((m) => m.mark === "yes").length / marks.length) * 100) : null;
    }
    managers.push({
      email,
      name: email ? nameByEmail.get(email) ?? email : "Ничьи",
      analysed: fresh.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
      items,
      replyMinutes: median(list.map((i) => i.replyMinutes).filter((v): v is number => v !== null)),
      waiting: list.filter((i) => !isClosedStage(i.stage) && i.waitingSince && i.waitingSince <= waitBefore).length,
      hot: list.filter((i) => !isClosedStage(i.stage) && i.analysis?.temperature === "hot").length,
    });
  }
  managers.sort((a, b) => (b.analysed - a.analysed) || a.name.localeCompare(b.name, "ru"));

  const counts = new Map<string, number>();
  for (const info of infos) {
    const a = info.analysis;
    if (!a || a.createdAt < since) continue;
    // Одно возражение одного лида считается один раз, сколько бы раз его ни повторили.
    for (const kind of Array.from(new Set(a.objections.map((o) => o.kind)))) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const objections = Array.from(counts.entries())
    .map(([kind, count]) => ({ kind, label: objectionLabel(kind), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));

  const open = infos.filter((i) => !isClosedStage(i.stage));
  return {
    managers,
    objections,
    hot: open.filter((i) => i.analysis?.temperature === "hot").sort((a, b) => ((a.lastAt ?? "") < (b.lastAt ?? "") ? 1 : -1)),
    waiting: open
      .filter((i) => i.waitingSince && i.waitingSince <= waitBefore)
      .sort((a, b) => ((a.waitingSince ?? "") < (b.waitingSince ?? "") ? -1 : 1)),
    stale: open.filter((i) => i.messages >= MIN_MESSAGES_FOR_ANALYSIS && i.newMessages > 0).sort((a, b) => b.newMessages - a.newMessages),
    analysedTotal: infos.filter((i) => i.analysis && i.analysis.createdAt >= since).length,
  };
}
