"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { phoneKey } from "@/lib/leads";
import { canSeeLine } from "@/lib/chatAccess";
import { listWaMessages } from "@/lib/repo/talks";
import { closeAssistantNotes, listAssistantLog, listWaLines } from "@/lib/repo/waLines";
import { assistantAnswer, DRAFT_TASK, sendFromLine, sendOnLine } from "@/lib/lineAssistant";
import { greenLeadsConfig } from "@/lib/greenApi";
import { canSendOnLeadsLine } from "@/lib/chatAccess";
import { isManagerLine } from "@/lib/waLines";
import { listUsers } from "@/lib/repo/users";

/**
 * «Клиенты → Переписки» (16.10.2026). Смотрят: владелец и РОП — все номера, менеджер — свой,
 * Земфира — свой. Отправлять из CRM можно только с номера менеджера: самому менеджеру и админу.
 */
async function requireChatUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  return { email: session.user.email.trim().toLowerCase(), role: session.user.role };
}

async function chatOf(line: string, phone: string) {
  const key = phoneKey(phone);
  if (!key) throw new Error("Неверный номер");
  const chat = (await listWaMessages({ lines: "all" })).filter((m) => (m.line || "") === line && phoneKey(m.phone) === key);
  if (chat.length === 0) throw new Error("Переписки с этим номером на этой линии нет");
  return chat;
}

async function draftReplyActionInner(line: string, phone: string): Promise<{ text: string; note: string; silent: boolean }> {
  const { email, role } = await requireChatUser();
  if (!(await canSeeLine(role, email, line))) throw new Error("Это чужой номер");
  const chat = await chatOf(line, phone);
  const owner = isManagerLine(line) ? (await listWaLines()).find((l) => l.code === line)?.managerEmail ?? "" : email;
  const name = ((await listUsers()).find((u) => u.email.toLowerCase() === owner)?.name || "").split(/\s+/)[0] || "";
  const a = await assistantAnswer(chat, chat[chat.length - 1].phone, name, DRAFT_TASK);
  return { text: a.reply, note: a.note, silent: a.silent };
}

async function sendReplyActionInner(line: string, phone: string, text: string): Promise<{ messageId: string }> {
  const { email, role } = await requireChatUser();
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) throw new Error("Пустое сообщение");
  if (clean.length > 3000) throw new Error("Слишком длинное сообщение");
  let id: string;
  if (line === "leads") {
    // Номер Земфиры: пишет она сама, РОП и админ (19.10.2026, владелец: «нажать „предложить ответ“ и реально отправить»).
    if (!canSendOnLeadsLine(role)) throw new Error("С номера Земфиры пишут она, РОП и администратор");
    const cfg = greenLeadsConfig();
    if (!cfg) throw new Error("Номер Земфиры не подключён (ключи GREENAPI_LEADS_* не заданы)");
    const chat = await chatOf(line, phone);
    id = await sendOnLine("leads", cfg, chat[chat.length - 1].phone, clean, "crm", email);
  } else {
    if (!isManagerLine(line)) throw new Error("С основного номера отвечает бот — писать отсюда можно с номеров менеджеров и Земфиры");
    const l = (await listWaLines({ fresh: true })).find((x) => x.code === line);
    if (!l) throw new Error("Номер не найден");
    if (role !== ROLES.ADMIN && l.managerEmail !== email) throw new Error("Писать с этого номера может его менеджер или администратор");
    const chat = await chatOf(line, phone);
    id = await sendFromLine(l, chat[chat.length - 1].phone, clean, "crm", email);
  }
  // Ответили — записки «нужен менеджер» по этому чату закрыты.
  const notes = (await listAssistantLog({ fresh: true })).filter((r) => r.kind === "note" && !r.doneAt && r.line === line && phoneKey(r.phone) === phoneKey(phone));
  await closeAssistantNotes(notes.map((n) => n.rowNumber), new Date().toISOString());
  revalidatePath("/clients/chats");
  return { messageId: id };
}

async function closeNoteActionInner(line: string, phone: string): Promise<{ closed: number }> {
  const { email, role } = await requireChatUser();
  if (!(await canSeeLine(role, email, line))) throw new Error("Это чужой номер");
  const notes = (await listAssistantLog({ fresh: true })).filter((r) => r.kind === "note" && !r.doneAt && r.line === line && phoneKey(r.phone) === phoneKey(phone));
  await closeAssistantNotes(notes.map((n) => n.rowNumber), new Date().toISOString());
  revalidatePath("/clients/chats");
  return { closed: notes.length };
}

export async function draftReplyAction(...args: Parameters<typeof draftReplyActionInner>) {
  return guard(() => draftReplyActionInner(...args));
}
export async function sendReplyAction(...args: Parameters<typeof sendReplyActionInner>) {
  return guard(() => sendReplyActionInner(...args));
}
export async function closeNoteAction(...args: Parameters<typeof closeNoteActionInner>) {
  return guard(() => closeNoteActionInner(...args));
}
