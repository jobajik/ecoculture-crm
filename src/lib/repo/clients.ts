import { appendRow, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import type { Client } from "../types";

/**
 * Клиентская база во вкладке Clients.
 *
 * Чтения обёрнуты в try/catch: пока вкладка не создана (`npm run setup-sheet`),
 * страница должна показывать пустой список, а не падать.
 *
 * Имя клиента НЕ уникально на уровне таблицы — Google Sheets этого не умеет.
 * Проверка на двойника делается при заведении (`findSimilar`) и намеренно
 * мягкая: она предупреждает, но не запрещает. Бывают два «Магнолии» в разных
 * городах, и запрет здесь заставил бы менеджера выкручиваться, придумывая
 * «Магнолия2».
 */

function toClient(record: Record<string, string>): Client {
  return {
    clientId: record.ClientID || "",
    createdAt: toIsoDateTime(record.CreatedAt),
    name: record.Name || "",
    city: record.City || "",
    shopName: record.ShopName || "",
    clientType: record.ClientType || "",
    contactPerson: record.ContactPerson || "",
    phone: record.Phone || "",
    messenger: record.Messenger || "",
    address: record.Address || "",
    paymentTerms: record.PaymentTerms || "",
    source: record.Source || "",
    note: record.Note || "",
    managerEmail: (record.ManagerEmail || "").trim().toLowerCase(),
    paymentMethod: record.PaymentMethod || "",
    kaspiAccount: record.KaspiAccount || "",
    kaspiPhone1: record.KaspiPhone1 || "",
    kaspiPhone2: record.KaspiPhone2 || "",
    // Пустая ячейка — активен: новую строку в таблице заводят, не дописывая
    // галочку. Отключён только тот, у кого явно сказано «нет».
    active: !["FALSE", "НЕТ", "NO", "0", "-"].includes(
      (record.Active || "").trim().toUpperCase()
    ),
  };
}

export async function listClients(): Promise<Client[]> {
  try {
    const table = await readTable(SHEET_TABS.CLIENTS);
    return table.rows
      .map((row) => toClient(rowToRecord(SHEET_TABS.CLIENTS, row)))
      .filter((c) => c.clientId && c.name)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  } catch {
    return [];
  }
}

export async function getClientById(clientId: string): Promise<Client | null> {
  const all = await listClients();
  return all.find((c) => c.clientId === clientId) ?? null;
}

/** Ключ для сравнения названий: «ТОО «Цветы 24»» и «цветы 24» — одно и то же. */
export function nameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'`]/g, "")
    .replace(/\b(тоо|ип|ооо|тд|компания)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** Похожие клиенты — чтобы предупредить менеджера о двойнике до записи. */
export async function findSimilar(name: string, city: string): Promise<Client[]> {
  const key = nameKey(name);
  if (!key) return [];
  const all = await listClients();
  return all.filter(
    (c) => nameKey(c.name) === key || (city && nameKey(c.shopName) === key && c.city === city)
  );
}

export type NewClientInput = Omit<Client, "clientId" | "createdAt" | "active">;

export async function createClient(input: NewClientInput): Promise<string> {
  const clientId = generateId("CLI");
  await appendRow(SHEET_TABS.CLIENTS, {
    ClientID: clientId,
    CreatedAt: new Date().toISOString(),
    Name: input.name,
    City: input.city,
    ShopName: input.shopName,
    ClientType: input.clientType,
    ContactPerson: input.contactPerson,
    Phone: input.phone,
    Messenger: input.messenger,
    Address: input.address,
    PaymentTerms: input.paymentTerms,
    Source: input.source,
    Note: input.note,
    ManagerEmail: input.managerEmail,
    Active: "TRUE",
    PaymentMethod: input.paymentMethod,
    KaspiAccount: input.kaspiAccount,
    KaspiPhone1: input.kaspiPhone1,
    KaspiPhone2: input.kaspiPhone2,
  });
  return clientId;
}

/**
 * Правка карточки. ManagerEmail тоже можно поменять — это передача клиента
 * другому менеджеру, и на неё имеют право только РОП и админ (проверяется в
 * действии, а не здесь).
 */
export async function updateClient(
  clientId: string,
  patch: Partial<NewClientInput> & { active?: boolean }
): Promise<boolean> {
  const map: Record<string, string> = {};
  if (patch.name !== undefined) map.Name = patch.name;
  if (patch.city !== undefined) map.City = patch.city;
  if (patch.shopName !== undefined) map.ShopName = patch.shopName;
  if (patch.clientType !== undefined) map.ClientType = patch.clientType;
  if (patch.contactPerson !== undefined) map.ContactPerson = patch.contactPerson;
  if (patch.phone !== undefined) map.Phone = patch.phone;
  if (patch.messenger !== undefined) map.Messenger = patch.messenger;
  if (patch.address !== undefined) map.Address = patch.address;
  if (patch.paymentTerms !== undefined) map.PaymentTerms = patch.paymentTerms;
  if (patch.source !== undefined) map.Source = patch.source;
  if (patch.note !== undefined) map.Note = patch.note;
  if (patch.managerEmail !== undefined) map.ManagerEmail = patch.managerEmail;
  if (patch.paymentMethod !== undefined) map.PaymentMethod = patch.paymentMethod;
  if (patch.kaspiAccount !== undefined) map.KaspiAccount = patch.kaspiAccount;
  if (patch.kaspiPhone1 !== undefined) map.KaspiPhone1 = patch.kaspiPhone1;
  if (patch.kaspiPhone2 !== undefined) map.KaspiPhone2 = patch.kaspiPhone2;
  if (patch.active !== undefined) map.Active = patch.active ? "TRUE" : "FALSE";

  if (Object.keys(map).length === 0) return false;
  return updateWhere(SHEET_TABS.CLIENTS, (record) => record.ClientID === clientId, () => map);
}
