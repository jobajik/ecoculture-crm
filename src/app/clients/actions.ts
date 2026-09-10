"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import {
  createClient,
  findSimilar,
  getClientById,
  updateClient,
  type NewClientInput,
} from "@/lib/repo/clients";
import { CLIENT_SOURCES, CLIENT_TYPES, PAYMENT_TERMS, ROLES } from "@/lib/constants";

/**
 * Клиентскую базу ведут те, кто продаёт.
 *
 * Заводить может любой менеджер: клиент появляется в момент первого разговора,
 * и заставлять ждать РОПа — верный способ получить заявки без карточек.
 * Править — только своего клиента; РОП и админ правят любого и могут передать
 * клиента другому менеджеру.
 */
async function requireSales() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== ROLES.MANAGER && role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) {
    throw new Error("Недостаточно прав: клиентскую базу ведут менеджеры и РОП");
  }
  return {
    email: session.user.email.trim().toLowerCase(),
    role,
    /** РОП и админ работают по всей базе, менеджер — только по своим карточкам. */
    all: role === ROLES.SALES_HEAD || role === ROLES.ADMIN,
  };
}

/** Значение из закрытого списка или пустая строка — выдуманного не пропускаем. */
function fromList(value: string, list: readonly string[]): string {
  const clean = (value || "").trim();
  return list.includes(clean) ? clean : "";
}

function clean(input: Partial<NewClientInput>) {
  return {
    name: (input.name ?? "").trim(),
    city: (input.city ?? "").trim(),
    shopName: (input.shopName ?? "").trim(),
    clientType: fromList(input.clientType ?? "", CLIENT_TYPES),
    contactPerson: (input.contactPerson ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    messenger: (input.messenger ?? "").trim(),
    address: (input.address ?? "").trim(),
    paymentTerms: fromList(input.paymentTerms ?? "", PAYMENT_TERMS),
    source: fromList(input.source ?? "", CLIENT_SOURCES),
    note: (input.note ?? "").trim(),
  };
}

export async function createClientAction(input: Omit<NewClientInput, "managerEmail">) {
  const { email } = await requireSales();
  const data = clean(input);

  if (!data.name) throw new Error("Укажите название клиента");
  if (!data.city) throw new Error("Укажите город — без него не посчитать, куда мы возим");
  if (data.name.length > 200) throw new Error("Слишком длинное название");

  // Предупреждение о двойнике намеренно НЕ запрет: бывают два салона «Магнолия»
  // в разных городах, и запрет заставил бы менеджера выкручиваться, назвав
  // второго «Магнолия2» — от чего база стала бы хуже, а не лучше.
  const similar = await findSimilar(data.name, data.city);
  const clientId = await createClient({ ...data, managerEmail: email });

  revalidatePath("/clients");
  return {
    clientId,
    /** Кого стоит проверить глазами — показывается менеджеру после сохранения. */
    similar: similar.map((c) => ({ clientId: c.clientId, name: c.name, city: c.city })),
  };
}

export async function updateClientAction(
  clientId: string,
  input: Partial<NewClientInput> & { active?: boolean }
) {
  const { email, all } = await requireSales();

  const client = await getClientById(clientId);
  if (!client) throw new Error("Клиент не найден");
  if (!all && client.managerEmail !== email) {
    throw new Error("Это клиент другого менеджера — правит его менеджер или РОП");
  }

  const data = clean(input);
  if (input.name !== undefined && !data.name) throw new Error("Название не может быть пустым");
  if (input.city !== undefined && !data.city) throw new Error("Город не может быть пустым");

  // Передать клиента другому менеджеру может только РОП или админ: иначе
  // чужого клиента можно было бы тихо записать на себя вместе с его выручкой.
  const patch: Partial<NewClientInput> & { active?: boolean } = { ...data };
  if (input.managerEmail !== undefined) {
    if (!all) throw new Error("Передать клиента другому менеджеру может только РОП");
    patch.managerEmail = input.managerEmail.trim().toLowerCase();
  }
  if (input.active !== undefined) patch.active = input.active;

  await updateClient(clientId, patch);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
