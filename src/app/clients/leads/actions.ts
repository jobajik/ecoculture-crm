"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { CLIENT_SOURCES, CLIENT_TYPES, PAYMENT_TERMS, ROLES } from "@/lib/constants";
import { localDayKey } from "@/lib/timezone";
import {
  canManageLeads,
  canUseLeads,
  canWorkLead,
  cleanStage,
  leadChangesAfterTouch,
  nameKey,
  parseLeadMatrix,
  phoneKey,
  stageIndex,
  touchRefusal,
  type LeadImportResult,
  type LeadImportRow,
  type TouchInput,
} from "@/lib/leads";
import { addTouch, createLead, createLeads, getLead, listLeads, updateLead, type NewLead } from "@/lib/repo/leads";
import { createClient, listClients } from "@/lib/repo/clients";
import { listUsers } from "@/lib/repo/users";
import { readFirstSheetMatrix } from "@/lib/excel";

/**
 * Лиды ведут продажи. Менеджер работает со своими лидами и может взять
 * ничейный; РОП и админ видят всех, раздают и загружают базу файлом. Все
 * запреты — здесь, на сервере (грабли 1.11), а браузер только подсказывает.
 */
async function requireLeads() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (!canUseLeads(role)) throw new Error("Лидами занимаются менеджеры и РОП");
  return { email: session.user.email.trim().toLowerCase(), role, manage: canManageLeads(role) };
}

const LEADS_PATH = "/clients/leads";

function fromList(value: string | undefined, list: readonly string[]): string {
  const v = (value || "").trim();
  return list.includes(v) ? v : "";
}

interface LeadInfo {
  name: string;
  city: string;
  contactPerson: string;
  phone: string;
  clientType: string;
  source: string;
  address: string;
  note: string;
}

function cleanInfo(input: Partial<LeadInfo>): LeadInfo {
  return {
    name: (input.name ?? "").trim(),
    city: (input.city ?? "").trim(),
    contactPerson: (input.contactPerson ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    clientType: fromList(input.clientType, CLIENT_TYPES),
    source: fromList(input.source, CLIENT_SOURCES),
    address: (input.address ?? "").trim(),
    note: (input.note ?? "").trim(),
  };
}

/** Кому можно отдать лид: активные менеджеры (и сам РОП, если он продаёт). */
async function assignableEmails(): Promise<Set<string>> {
  const users = await listUsers();
  return new Set(
    users
      .filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD))
      .map((u) => u.email.toLowerCase())
  );
}

/** Двойник по телефону среди лидов и клиентов — такого не заводим. */
async function phoneTwin(phone: string, exceptLeadId = ""): Promise<string> {
  const key = phoneKey(phone);
  if (!key) return "";
  const [leads, clients] = await Promise.all([listLeads({ fresh: true }), listClients()]);
  const lead = leads.find((l) => l.leadId !== exceptLeadId && phoneKey(l.phone) === key);
  if (lead) return `Этот телефон уже есть у лида «${lead.name}»`;
  const client = clients.find((c) => phoneKey(c.phone) === key);
  if (client) return `Этот телефон уже у клиента «${client.name}» — он уже покупает`;
  return "";
}

// --- Новый лид -------------------------------------------------------------------

async function createLeadActionInner(input: Partial<LeadInfo> & { managerEmail?: string }) {
  const { email, manage } = await requireLeads();
  const info = cleanInfo(input);
  if (!info.name) throw new Error("Укажите название");
  if (info.name.length > 200) throw new Error("Слишком длинное название");
  if (!info.phone && !info.contactPerson) throw new Error("Укажите телефон или контакт — иначе с кем говорить?");

  // Менеджер заводит лид на себя. РОП может отдать сразу менеджеру или оставить ничьим.
  let managerEmail = email;
  if (manage) {
    const asked = (input.managerEmail ?? "").trim().toLowerCase();
    if (asked && !(await assignableEmails()).has(asked)) throw new Error("Такого менеджера нет");
    managerEmail = asked;
  }

  const twin = await phoneTwin(info.phone);
  if (twin) throw new Error(twin);

  const leads = await listLeads();
  const similar = leads.filter((l) => nameKey(l.name) === nameKey(info.name)).map((l) => ({ leadId: l.leadId, name: l.name, city: l.city }));
  const lead: NewLead = { ...info, createdByEmail: email, managerEmail };
  // Новый лид сразу встаёт в «на сегодня»: его заводят, чтобы позвонить.
  const leadId = await createLead(lead, localDayKey());
  revalidatePath(LEADS_PATH);
  return { leadId, similar };
}

// --- Правка карточки и передача ---------------------------------------------------

async function updateLeadActionInner(leadId: string, input: Partial<LeadInfo> & { managerEmail?: string }) {
  const { email, role, manage } = await requireLeads();
  const lead = await getLead(leadId, { fresh: true });
  if (!lead) throw new Error("Лид не найден");
  if (!canWorkLead(role, email, lead)) throw new Error("Это лид другого менеджера");

  const changes: Record<string, string> = {};
  const info = cleanInfo({ ...lead, ...input });
  if (!info.name) throw new Error("Название не может быть пустым");
  if (info.phone !== lead.phone) {
    const twin = await phoneTwin(info.phone, leadId);
    if (twin) throw new Error(twin);
  }
  const map: Record<keyof LeadInfo, string> = {
    name: "Name",
    city: "City",
    contactPerson: "ContactPerson",
    phone: "Phone",
    clientType: "ClientType",
    source: "Source",
    address: "Address",
    note: "Note",
  };
  for (const [field, column] of Object.entries(map) as [keyof LeadInfo, string][]) {
    if (input[field] !== undefined && info[field] !== lead[field]) changes[column] = info[field];
  }
  // Передать лид — только РОП и админ, и только если значение ПРАВДА меняется
  // (форма присылает поле всегда — грабли 1.13).
  if (input.managerEmail !== undefined) {
    const asked = input.managerEmail.trim().toLowerCase();
    if (asked !== lead.managerEmail) {
      if (!manage) throw new Error("Передать лид другому менеджеру может только РОП");
      if (asked && !(await assignableEmails()).has(asked)) throw new Error("Такого менеджера нет");
      changes.ManagerEmail = asked;
    }
  }
  await updateLead(leadId, changes);
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/${leadId}`);
  return { ok: true };
}

/** Менеджер берёт ничейный лид себе. */
async function takeLeadActionInner(leadId: string) {
  const { email, role } = await requireLeads();
  if (role !== ROLES.MANAGER && role !== ROLES.SALES_HEAD) throw new Error("Брать лиды себе могут менеджеры");
  const lead = await getLead(leadId, { fresh: true });
  if (!lead) throw new Error("Лид не найден");
  if (lead.managerEmail) {
    throw new Error(lead.managerEmail === email ? "Лид уже ваш" : "Этот лид уже взял другой менеджер");
  }
  await updateLead(leadId, { ManagerEmail: email, NextTouchAt: lead.nextTouchAt || localDayKey() });
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/${leadId}`);
  return { ok: true };
}

// --- Касание ---------------------------------------------------------------------

async function addTouchActionInner(leadId: string, input: TouchInput) {
  const { email, role } = await requireLeads();
  const lead = await getLead(leadId, { fresh: true });
  if (!lead) throw new Error("Лид не найден");
  if (!canWorkLead(role, email, lead)) {
    throw new Error(lead.managerEmail ? "Это лид другого менеджера" : "Сначала возьмите лид себе");
  }
  const clean: TouchInput = {
    channel: (input.channel || "").trim(),
    comment: (input.comment || "").trim(),
    stage: (input.stage || "").trim(),
    nextTouchAt: (input.nextTouchAt || "").trim(),
    lostReason: (input.lostReason || "").trim(),
  };
  const today = localDayKey();
  const refusal = touchRefusal(clean, lead, today);
  if (refusal) throw new Error(refusal);

  const now = new Date().toISOString();
  const from = cleanStage(lead.stage);
  await addTouch(
    leadId,
    {
      managerEmail: email,
      channel: clean.channel,
      comment: clean.comment,
      stageFrom: from,
      stageTo: clean.stage,
      nextTouchAt: clean.nextTouchAt,
    },
    leadChangesAfterTouch(lead, clean, now),
    now
  );
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/${leadId}`);
  return { ok: true };
}

// --- Лид → клиент -----------------------------------------------------------------

/**
 * Заводит карточку клиента из лида — без неё заявку не оформить. Если клиент с
 * тем же телефоном уже есть, лид привязывается к нему, а не плодит двойника.
 */
async function convertLeadActionInner(leadId: string, input: { paymentTerms?: string } = {}) {
  const { email, role } = await requireLeads();
  const lead = await getLead(leadId, { fresh: true });
  if (!lead) throw new Error("Лид не найден");
  if (!canWorkLead(role, email, lead)) throw new Error("Это лид другого менеджера");
  if (lead.clientId) return { clientId: lead.clientId, linked: true };
  if (!lead.city.trim()) throw new Error("Укажите город лида — без него клиента не завести");

  const key = phoneKey(lead.phone);
  const existing = key ? (await listClients()).find((c) => phoneKey(c.phone) === key) : undefined;
  let clientId = existing?.clientId ?? "";
  if (!clientId) {
    clientId = await createClient({
      name: lead.name,
      city: lead.city,
      shopName: "",
      clientType: fromList(lead.clientType, CLIENT_TYPES),
      contactPerson: lead.contactPerson,
      phone: lead.phone,
      messenger: "",
      address: lead.address,
      paymentTerms: fromList(input.paymentTerms, PAYMENT_TERMS),
      source: fromList(lead.source, CLIENT_SOURCES),
      note: lead.note,
      managerEmail: lead.managerEmail || email,
      paymentMethod: "",
      kaspiPay1: "",
      kaspiPay2: "",
      retail: "",
    });
  }
  const changes: Record<string, string> = { ClientID: clientId };
  if (stageIndex(cleanStage(lead.stage)) < stageIndex("trial") || lead.stage === "lost") {
    changes.Stage = "trial";
    changes.StageChangedAt = new Date().toISOString();
    changes.LostReason = "";
  }
  if (!lead.managerEmail) changes.ManagerEmail = email;
  await updateLead(leadId, changes);
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/${leadId}`);
  revalidatePath("/clients");
  return { clientId, linked: !!existing };
}

// --- Загрузка базы файлом ------------------------------------------------------------

async function parseLeadFileActionInner(formData: FormData): Promise<LeadImportResult> {
  const { manage } = await requireLeads();
  if (!manage) throw new Error("Базу лидов загружает РОП");
  const file = formData.get("file");
  if (!file || typeof file === "string") return { rows: [], fresh: 0, skipped: 0, fatalError: "Файл не получен" };
  const matrix = await readFirstSheetMatrix(await (file as File).arrayBuffer(), (file as File).name);
  if (!matrix) return { rows: [], fresh: 0, skipped: 0, fatalError: "Не удалось прочитать файл. Нужен Excel (.xlsx) или CSV." };
  const [leads, clients, users] = await Promise.all([listLeads(), listClients(), listUsers()]);
  return parseLeadMatrix(matrix, { leads, clients }, users.filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD)));
}

/**
 * Записывает новые строки. Двойники проверяются ЗАНОВО по свежей базе:
 * между предпросмотром и нажатием кто-то мог завести тот же лид, а присланным
 * из браузера строкам сервер не верит (грабли 1.11).
 */
async function importLeadsActionInner(rows: LeadImportRow[], defaultManager = "") {
  const { email, manage } = await requireLeads();
  if (!manage) throw new Error("Базу лидов загружает РОП");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Нечего загружать");
  if (rows.length > 3000) throw new Error("Больше 3 000 строк за раз не загружаем");

  const header = ["Название", "Город", "Телефон", "Контактное лицо", "Тип точки", "Источник", "Адрес", "Комментарий", "Менеджер"];
  const matrix = [
    header,
    ...rows.map((r) => [r.name, r.city, r.phone, r.contactPerson, r.clientType, r.source, r.address, r.note, r.managerEmail || r.managerRaw].map((v) => String(v ?? ""))),
  ];
  const [leads, clients, users] = await Promise.all([listLeads({ fresh: true }), listClients(), listUsers()]);
  const sellers = users.filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD));
  const parsed = parseLeadMatrix(matrix, { leads, clients }, sellers);
  if (parsed.fatalError) throw new Error(parsed.fatalError);

  const fallback = defaultManager.trim().toLowerCase();
  if (fallback && !sellers.some((u) => u.email.toLowerCase() === fallback)) throw new Error("Такого менеджера нет");
  const fresh = parsed.rows.filter((r) => !r.skip);
  const created = await createLeads(
    fresh.map((r) => ({
      createdByEmail: email,
      name: r.name,
      city: r.city,
      contactPerson: r.contactPerson,
      phone: r.phone,
      clientType: r.clientType,
      source: r.source,
      address: r.address,
      note: r.note,
      managerEmail: r.managerEmail || fallback,
    }))
  );
  revalidatePath(LEADS_PATH);
  return { created, skipped: parsed.rows.length - fresh.length };
}

// ---------------------------------------------------------------------------
// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
// ---------------------------------------------------------------------------

export async function createLeadAction(...args: Parameters<typeof createLeadActionInner>) {
  return guard(() => createLeadActionInner(...args));
}
export async function updateLeadAction(...args: Parameters<typeof updateLeadActionInner>) {
  return guard(() => updateLeadActionInner(...args));
}
export async function takeLeadAction(...args: Parameters<typeof takeLeadActionInner>) {
  return guard(() => takeLeadActionInner(...args));
}
export async function addTouchAction(...args: Parameters<typeof addTouchActionInner>) {
  return guard(() => addTouchActionInner(...args));
}
export async function convertLeadAction(...args: Parameters<typeof convertLeadActionInner>) {
  return guard(() => convertLeadActionInner(...args));
}
export async function parseLeadFileAction(...args: Parameters<typeof parseLeadFileActionInner>) {
  return guard(() => parseLeadFileActionInner(...args));
}
export async function importLeadsAction(...args: Parameters<typeof importLeadsActionInner>) {
  return guard(() => importLeadsActionInner(...args));
}
