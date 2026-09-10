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
import { CLIENT_SOURCES, CLIENT_TYPES, PAYMENT_METHODS, PAYMENT_TERMS, ROLES } from "@/lib/constants";
import { kaspiFieldsFor } from "@/lib/clientPick";
import { canSeeShop, cleanTerritory, isOwnShop, retailTerritoryFor } from "@/lib/retail";

/**
 * Клиентскую базу ведут те, кто продаёт.
 *
 * Заводить может любой менеджер: клиент появляется в момент первого разговора,
 * и заставлять ждать РОПа — верный способ получить заявки без карточек.
 * Править — только своего клиента; РОП и админ правят любого и могут передать
 * клиента другому менеджеру.
 *
 * Менеджеры розницы работают в той же базе, но в другой её части: карточки
 * НАШИХ магазинов своего направления. Клиентов они не видят и не правят, а
 * обычные менеджеры так же не трогают магазины — это не «клиент другого
 * менеджера», а вообще другая сущность.
 */
async function requireSales() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  const territory = retailTerritoryFor(role);
  if (
    role !== ROLES.MANAGER &&
    role !== ROLES.SALES_HEAD &&
    role !== ROLES.ADMIN &&
    !territory
  ) {
    throw new Error("Недостаточно прав: клиентскую базу ведут менеджеры и РОП");
  }
  return {
    email: session.user.email.trim().toLowerCase(),
    role,
    /** РОП и админ работают по всей базе, менеджер — только по своим карточкам. */
    all: role === ROLES.SALES_HEAD || role === ROLES.ADMIN,
    /** Направление розницы, если это менеджер розницы; иначе null. */
    territory,
  };
}

/** Значение из закрытого списка или пустая строка — выдуманного не пропускаем. */
function fromList(value: string, list: readonly string[]): string {
  const clean = (value || "").trim();
  return list.includes(clean) ? clean : "";
}

function clean(input: Partial<NewClientInput>) {
  const method = fromList(input.paymentMethod ?? "", PAYMENT_METHODS);
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
    paymentMethod: method,
    // Правило «каспи-поля только при оплате Каспи» — общее и проверено тестом.
    ...kaspiFieldsFor(method, input),
  };
}

export async function createClientAction(input: Omit<NewClientInput, "managerEmail">) {
  const { email, all, territory } = await requireSales();
  const data = clean(input);

  // Кем заводится карточка — клиентом или нашим магазином — решает роль, а не
  // то, что пришло из браузера. Менеджер розницы заводит только точку своего
  // направления (открылся магазин — карточка нужна сразу, ждать РОПа незачем),
  // РОП и админ могут завести любую, обычный менеджер — только клиента.
  const asked = cleanTerritory(input.retail);
  let retail = "";
  if (territory) retail = territory;
  else if (asked && all) retail = asked;
  else if (asked) throw new Error("Отметить карточку нашим магазином может только РОП");

  if (!data.name) throw new Error("Укажите название клиента");
  if (!data.city) throw new Error("Укажите город — без него не посчитать, куда мы возим");
  if (data.name.length > 200) throw new Error("Слишком длинное название");

  // Предупреждение о двойнике намеренно НЕ запрет: бывают два салона «Магнолия»
  // в разных городах, и запрет заставил бы менеджера выкручиваться, назвав
  // второго «Магнолия2» — от чего база стала бы хуже, а не лучше.
  const similar = await findSimilar(data.name, data.city);
  const clientId = await createClient({ ...data, retail, managerEmail: email });

  revalidatePath("/clients");
  revalidatePath("/retail");
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
  const { email, all, role, territory } = await requireSales();

  const client = await getClientById(clientId);
  if (!client) throw new Error("Клиент не найден");

  // Наш магазин и клиент — разные сущности, и правят их разные люди.
  if (isOwnShop(client)) {
    if (!all && !canSeeShop(role, client)) {
      throw new Error("Это магазин другого направления");
    }
  } else {
    if (territory) throw new Error("Менеджер розницы работает только со своими магазинами");
    if (!all && client.managerEmail !== email) {
      throw new Error("Это клиент другого менеджера — правит его менеджер или РОП");
    }
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
  // Перевести точку в другое направление (или сделать клиента нашим магазином)
  // может только РОП. Иначе граница между Алматы и регионами держалась бы на
  // честном слове: любой менеджер розницы забрал бы себе чужую точку.
  if (input.retail !== undefined) {
    if (!all) throw new Error("Направление розницы меняет только РОП");
    patch.retail = cleanTerritory(input.retail);
  }
  if (input.active !== undefined) patch.active = input.active;

  await updateClient(clientId, patch);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/retail");
  return { ok: true };
}
