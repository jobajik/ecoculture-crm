import { LEAD_ORIGIN_ADS, phoneKey } from "./leads";
import { newClientName } from "./botOrder";
import { messageText, prettyWaPhone } from "./whatsapp";
import type { NewLead } from "./repo/leads";
import type { AppUser, WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Номер Земфиры: кто НАПИСАЛ ей сам и кого нет ни в лидах, ни в клиентах,
// сразу становится её лидом «с рекламы» (15.10.2026, владелец: «чтобы клиенты,
// которые ей будут писать, автоматом заносились в базу»). Раньше такой номер
// только висел в «Написали в WhatsApp» и ждал кнопки «Завести лидом».
//
// Только входящие: если Земфира написала первой на чужой номер — это не лид сам
// по себе (могут быть свои, поставщики, водители). Чистая функция — без таблиц.
// ---------------------------------------------------------------------------

export const WA_AUTO_LEAD_SOURCE = "Написали в WhatsApp";

/** Чья это линия: единственный активный «Лиды с рекламы», иначе первый по почте; нет — ничей. */
export function leadsLineOwner(users: Pick<AppUser, "email" | "role" | "active">[]): string {
  const own = users
    .filter((u) => u.active && u.role === "leadgen" && u.email)
    .map((u) => u.email.trim().toLowerCase())
    .sort();
  return own[0] ?? "";
}

/**
 * Лид из первого входящего с незнакомого номера — или null.
 * `known` — ключи телефонов (`phoneKey`) всех лидов и клиентов.
 */
export function autoLeadFromMessage(
  message: Pick<WaMessage, "direction" | "phone" | "senderName" | "type" | "text" | "at">,
  known: Set<string>,
  ownerEmail: string,
  day: string,
): NewLead | null {
  if (message.direction !== "in") return null;
  const key = phoneKey(message.phone);
  if (!key || known.has(key)) return null;
  const sender = (message.senderName || "").trim();
  const first = messageText(message).replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    name: newClientName("", sender, message.phone),
    city: "",
    contactPerson: sender.slice(0, 80),
    phone: prettyWaPhone(message.phone),
    clientType: "",
    source: WA_AUTO_LEAD_SOURCE,
    address: "",
    note: `Сам написал в WhatsApp Земфиры ${day}${first ? `: «${first}»` : ""}. Заведён автоматически — уточните название точки и город.`,
    createdByEmail: ownerEmail || "whatsapp",
    managerEmail: ownerEmail,
    origin: LEAD_ORIGIN_ADS,
  };
}
