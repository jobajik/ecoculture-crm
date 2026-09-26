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
  dealEvenly,
  leadChangesAfterTouch,
  MAX_IMPORT_ROWS,
  nameKey,
  parseLeadMatrix,
  rowsToMatrix,
  phoneKey,
  stageIndex,
  touchRefusal,
  type LeadImportResult,
  type LeadImportRow,
  type TouchInput,
} from "@/lib/leads";
import { addTouch, createLead, createLeads, getLead, listLeads, updateLead, type NewLead } from "@/lib/repo/leads";
import { listClients } from "@/lib/repo/clients";
import { listUsers } from "@/lib/repo/users";
import { ensureClientForLead } from "@/lib/leadConvert";

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
  const res = await ensureClientForLead(lead, email, { paymentTerms: input.paymentTerms, paymentTermsList: PAYMENT_TERMS });
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/${leadId}`);
  revalidatePath("/clients");
  return { clientId: res.clientId, linked: res.linked };
}

// --- Загрузка базы файлом ------------------------------------------------------------

/** Кто может получить лиды: активные менеджеры и РОП. */
async function sellers() {
  const users = await listUsers();
  return users.filter((u) => u.active && (u.role === ROLES.MANAGER || u.role === ROLES.SALES_HEAD));
}

/**
 * Предпросмотр загрузки. Файл разбирается в браузере (`xlsxLite.ts` — ExcelJS
 * читал выгрузку из прошлой CRM три минуты), сюда приходят строки, и сервер
 * проверяет их заново против живой базы: кто уже в лидах, кто уже клиент.
 */
async function checkLeadImportActionInner(rows: LeadImportRow[]): Promise<LeadImportResult> {
  const { manage } = await requireLeads();
  if (!manage) throw new Error("Базу лидов загружает РОП");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("В файле не нашлось строк");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Больше ${MAX_IMPORT_ROWS} строк за раз не загружаем — разбейте файл`);
  const [leads, clients, users] = await Promise.all([listLeads(), listClients(), sellers()]);
  const result = parseLeadMatrix(rowsToMatrix(rows), { leads, clients }, users);
  // Номер строки — из файла человека, а не из пересобранной таблицы.
  result.rows.forEach((r, i) => {
    r.line = rows[i]?.line ?? r.line;
  });
  return result;
}

/**
 * Записывает новые строки. Двойники проверяются ЗАНОВО по свежей базе:
 * между предпросмотром и нажатием кто-то мог завести тот же лид, а присланным
 * из браузера строкам сервер не верит (грабли 1.11).
 *
 * `distributeTo` — раздать поровну и случайно между этими менеджерами
 * (`dealEvenly`: бывшие покупатели делятся поровну отдельно от остальных);
 * пусто — менеджер из файла, если он узнан, иначе `defaultManager` или никто.
 */
async function importLeadsActionInner(
  rows: LeadImportRow[],
  options: { campaign?: string; distributeTo?: string[]; defaultManager?: string } = {}
) {
  const { email, manage } = await requireLeads();
  if (!manage) throw new Error("Базу лидов загружает РОП");
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Нечего загружать");
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Больше ${MAX_IMPORT_ROWS} строк за раз не загружаем`);
  const campaign = (options.campaign ?? "").trim().slice(0, 60);

  const [leads, clients, users] = await Promise.all([listLeads({ fresh: true }), listClients(), sellers()]);
  const parsed = parseLeadMatrix(rowsToMatrix(rows), { leads, clients }, users);
  if (parsed.fatalError) throw new Error(parsed.fatalError);

  const known = new Set(users.map((u) => u.email.toLowerCase()));
  const fallback = (options.defaultManager ?? "").trim().toLowerCase();
  if (fallback && !known.has(fallback)) throw new Error("Такого менеджера нет");
  const team = Array.from(new Set((options.distributeTo ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)));
  for (const e of team) if (!known.has(e)) throw new Error("В списке раздачи есть неизвестный менеджер");

  const fresh = parsed.rows.filter((r) => !r.skip);
  const dealt = team.length > 0 ? dealEvenly(fresh, team, (r) => r.pastOrders > 0) : null;
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
      managerEmail: dealt ? dealt.get(r) ?? "" : r.managerEmail || fallback,
      campaign,
      segment: r.segment,
      history: r.history,
      firstSeenAt: r.firstSeenAt,
      pastOrders: r.pastOrders,
    }))
  );
  revalidatePath(LEADS_PATH);
  revalidatePath(`${LEADS_PATH}/calls`);
  const perManager: Record<string, number> = {};
  if (dealt) for (const e of Array.from(dealt.values())) perManager[e] = (perManager[e] ?? 0) + 1;
  return { created, skipped: parsed.rows.length - fresh.length, perManager };
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
export async function checkLeadImportAction(...args: Parameters<typeof checkLeadImportActionInner>) {
  return guard(() => checkLeadImportActionInner(...args));
}
export async function importLeadsAction(...args: Parameters<typeof importLeadsActionInner>) {
  return guard(() => importLeadsActionInner(...args));
}
