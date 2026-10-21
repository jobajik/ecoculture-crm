import { LEAD_ORIGIN_ADS, phoneKey } from "./leads";
import { newClientName } from "./botOrder";
import { messageText, prettyWaPhone } from "./whatsapp";
import type { NewLead } from "./repo/leads";
import type { AppUser, Lead, WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Номер Земфиры: любой разговор с номером, которого нет ни в лидах, ни в
// клиентах, сразу становится её лидом «с рекламы» (15.10.2026, владелец: «чтобы
// клиенты, которые ей будут писать, автоматом заносились в базу»).
//
// И входящее, и её исходящее: живая переписка за 14–15.10 показала, что Земфира
// почти всегда пишет ПЕРВОЙ («цветы для себя или для бизнеса?») — заявки приходят
// из рекламы, а не сообщением; все 48 таких чатов — клиенты. Чистая функция.
// ---------------------------------------------------------------------------

export const WA_AUTO_LEAD_SOURCE = "Написали в WhatsApp";

/** Имя, которое лид получает, пока клиент не написал сам: «Клиент WhatsApp 2030». */
const PLACEHOLDER_NAME = /^Клиент WhatsApp \d{1,4}$/;

/** Чья это линия: единственный активный «Лиды с рекламы», иначе первый по почте; нет — ничей. */
export function leadsLineOwner(users: Pick<AppUser, "email" | "role" | "active">[]): string {
  const own = users
    .filter((u) => u.active && u.role === "leadgen" && u.email)
    .map((u) => u.email.trim().toLowerCase())
    .sort();
  return own[0] ?? "";
}

/**
 * Лид из первого сообщения с незнакомым номером — или null.
 * `known` — ключи телефонов (`phoneKey`) всех лидов и клиентов.
 */
export function autoLeadFromMessage(
  message: Pick<WaMessage, "direction" | "phone" | "senderName" | "type" | "text" | "at">,
  known: Set<string>,
  ownerEmail: string,
  day: string,
  /**
   * Номер менеджера (16.10.2026): чей номер в заметке («WhatsApp Ильяса»), лид обычный, не «с рекламы»,
   * и только ВХОДЯЩЕЕ — менеджер пишет первым и поставщикам, и водителям, и своим, а это не лиды.
   */
  line?: { whose: string; origin: string; incomingOnly: boolean; city?: string },
): NewLead | null {
  const key = phoneKey(message.phone);
  if (!key || known.has(key)) return null;
  const incoming = message.direction === "in";
  if (line?.incomingOnly && !incoming) return null;
  const whose = line?.whose || "Земфиры";
  const sender = incoming ? (message.senderName || "").trim() : "";
  const first = incoming ? messageText(message).replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const note = incoming
    ? `Сам написал в WhatsApp ${whose} ${day}${first ? `: «${first}»` : ""}.`
    : line
      ? `Написали первыми с WhatsApp ${whose} ${day}.`
      : `Земфира написала в WhatsApp ${day}.`;
  return {
    name: newClientName("", sender, message.phone),
    // Региональный менеджер (Салтанат — Астана): город её клиентов известен заранее.
    city: line?.city || "",
    contactPerson: sender.slice(0, 80),
    phone: prettyWaPhone(message.phone),
    clientType: "",
    source: WA_AUTO_LEAD_SOURCE,
    address: "",
    note: `${note} Заведён автоматически — уточните название точки${line?.city ? "" : " и город"}.`,
    createdByEmail: ownerEmail || "whatsapp",
    managerEmail: ownerEmail,
    origin: line ? line.origin : LEAD_ORIGIN_ADS,
  };
}

/**
 * Лид заведён с именем-заглушкой («Клиент WhatsApp 2030»), а клиент написал под своим
 * именем — имя и контакт лида берутся из WhatsApp. Иначе — null (своё имя не трогаем).
 */
export function namedFromWhatsApp(
  lead: Pick<Lead, "name" | "contactPerson">,
  message: Pick<WaMessage, "direction" | "senderName">,
): { Name: string; ContactPerson: string } | null {
  if (message.direction !== "in" || !PLACEHOLDER_NAME.test(lead.name.trim())) return null;
  const name = newClientName("", message.senderName || "", "");
  if (!name || name.startsWith("Клиент WhatsApp")) return null;
  return { Name: name, ContactPerson: lead.contactPerson || (message.senderName || "").trim().slice(0, 80) };
}

/**
 * Кто из авто-лидов на один номер остаётся, если два вебхука завели их одновременно (20.10.2026: у Земфиры «Асима» и
 * «Клиент WhatsApp 0574» в одну минуту). Решают оба вебхука одинаково: самый ранний, при равенстве — меньший номер;
 * проигравший удаляет свой. Пусто — свой лид оставить.
 */
export function autoLeadLoser(ownId: string, sameKey: Pick<Lead, "leadId" | "createdAt" | "note">[], now: Date, windowMin = 10): boolean {
  const recentAuto = sameKey.filter((l) => /Заведён автоматически/.test(l.note) && now.getTime() - Date.parse(l.createdAt) <= windowMin * 60000);
  if (!recentAuto.some((l) => l.leadId === ownId)) return false;
  // Есть лид старше окна или заведённый человеком — свой лишний.
  if (sameKey.some((l) => l.leadId !== ownId && !recentAuto.includes(l))) return true;
  const keeper = [...recentAuto].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.leadId < b.leadId ? -1 : 1))[0];
  return keeper.leadId !== ownId;
}

