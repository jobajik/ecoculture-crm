import { compareLeadRows, isClosedStage, phoneKey, type LeadRow } from "./leads";

// ---------------------------------------------------------------------------
// Список лидов «что делать сейчас» (15.10.2026, владелец: «визуально тяжело
// смотреть — сделай понятный и внятный интерфейс в лидах»). Лиды идут группами
// по срочности: ждут ответа в WhatsApp → просрочено → сегодня → запланировано →
// без следующего касания. База обзвона, которой ещё не звонили, в общий список
// не идёт — она во вкладке «Обзвон» (там 3 700 строк, и они хоронили живые лиды).
// Чистые функции: их зовёт список в браузере и проверка `check-leads`.
// ---------------------------------------------------------------------------

export type LeadGroup = "waiting" | "overdue" | "today" | "later" | "nodate" | "closed";

export const LEAD_GROUP_LABELS: Record<LeadGroup, string> = {
  waiting: "Ждут ответа в WhatsApp",
  overdue: "Просрочено",
  today: "На сегодня",
  later: "Запланировано",
  nodate: "Без следующего касания",
  closed: "Закрытые",
};

const GROUP_ORDER: LeadGroup[] = ["waiting", "overdue", "today", "later", "nodate", "closed"];

/** Что известно о переписке лида: ждёт ли ответа (минуты), «температура», оценка. */
export interface LeadTalkMark {
  waitingMinutes: number | null;
  temperature: string;
  score: number | null;
}

export type LeadView = "work" | "waiting" | "today" | "new" | "closed";
export type LeadOrigin = "all" | "ads" | "calls" | "other";

export function leadGroup(r: LeadRow, talk?: LeadTalkMark): LeadGroup {
  if (isClosedStage(r.stage)) return "closed";
  if (talk?.waitingMinutes != null) return "waiting";
  if (r.overdue) return "overdue";
  if (r.dueToday) return "today";
  return r.nextTouchAt ? "later" : "nodate";
}

/** Из базы обзвона, и ей ещё ни разу не звонили — живёт во вкладке «Обзвон». */
export function isUntouchedCallBase(r: Pick<LeadRow, "campaign" | "touches" | "stage">): boolean {
  return !!r.campaign && r.touches === 0 && r.stage === "new";
}

export function originOf(r: Pick<LeadRow, "origin" | "campaign">): Exclude<LeadOrigin, "all"> {
  if (r.origin === "ads") return "ads";
  if (r.campaign) return "calls";
  return "other";
}

export function matchesView(r: LeadRow, view: LeadView, talk?: LeadTalkMark): boolean {
  const closed = isClosedStage(r.stage);
  if (view === "closed") return closed;
  if (closed) return false;
  if (view === "waiting") return talk?.waitingMinutes != null;
  if (view === "today") return r.overdue || r.dueToday;
  if (view === "new") return r.stage === "new" && r.touches === 0;
  return true;
}

export function matchesQuery(r: LeadRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${r.name} ${r.city} ${r.contactPerson} ${r.managerName} ${r.phone}`.toLowerCase();
  if (hay.includes(q)) return true;
  const digits = phoneKey(query);
  return !!digits && phoneKey(r.phone).includes(digits.slice(-7));
}

/** Порядок: группа срочности, внутри — дольше ждущие ответа первыми, дальше `compareLeadRows`. */
export function sortLeadsForWork(rows: LeadRow[], talk: Record<string, LeadTalkMark>): LeadRow[] {
  const rank = (r: LeadRow) => GROUP_ORDER.indexOf(leadGroup(r, talk[r.leadId]));
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const wa = talk[a.leadId]?.waitingMinutes;
    const wb = talk[b.leadId]?.waitingMinutes;
    if (wa != null && wb != null && wa !== wb) return wb - wa;
    return compareLeadRows(a, b);
  });
}

/** Следующее касание словами: «сегодня», «16.10 · просрочено 2 дн.», «не назначено». */
export function nextTouchLabel(r: LeadRow, today: string, formatDay: (iso: string) => string): string {
  if (isClosedStage(r.stage)) return r.stage === "lost" ? r.lostReason || "отказ" : "клиент";
  if (!r.nextTouchAt) return "не назначено";
  if (r.dueToday) return "сегодня";
  if (r.overdue) {
    const days = Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${r.nextTouchAt.slice(0, 10)}T00:00:00`)) / 86_400_000);
    return days > 0 ? `просрочено ${days} дн.` : "просрочено";
  }
  return formatDay(r.nextTouchAt);
}
