"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listLeads } from "@/lib/repo/leads";
import { visibleOrdersFor } from "@/lib/orderVisibility";
import { canSearchClients, searchEverything, SEARCH_MIN_LENGTH, type SearchHit } from "@/lib/globalSearch";
import { canUseLeads } from "@/lib/leads";
import { localDayKey } from "@/lib/timezone";

/**
 * Общий поиск по сайту (Ctrl K): клиенты, заявки, лиды — одним запросом. Видимость — те же правила, что у страниц
 * (`visibleOrdersFor`, `canSeeLead`, список клиентов — тем, кто продаёт). Читается всё одним `prefetchTables`
 * (грабли 1.17), а память чтений на три секунды делает набор по буквам одним чтением, а не десятью.
 */
async function searchActionInner(query: string): Promise<SearchHit[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const q = String(query ?? "").trim();
  if (q.length < SEARCH_MIN_LENGTH) return [];
  const role = session.user.role;
  const tabs: string[] = [SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS];
  if (canUseLeads(role)) tabs.push(SHEET_TABS.LEADS);
  await prefetchTables(tabs);
  const [orders, clients, leads] = await Promise.all([
    listOrdersWithItems(),
    canSearchClients(role) ? listClients() : Promise.resolve([]),
    canUseLeads(role) ? listLeads() : Promise.resolve([]),
  ]);
  const user = { role, email: session.user.email, farm: session.user.farm };
  return searchEverything(q, { clients, orders: visibleOrdersFor(orders, user), leads }, user, localDayKey());
}

export async function searchAction(query: string) {
  return guard(() => searchActionInner(query));
}
