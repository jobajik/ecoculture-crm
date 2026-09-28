import { listClients } from "./repo/clients";
import { listLeads } from "./repo/leads";
import { listOrdersWithItems } from "./repo/orders";
import { optedOutKeys } from "./repo/broadcasts";
import { prefetchTables, SHEET_TABS } from "./sheets";
import { ORDER_STATUSES } from "./constants";
import { prepareAudience, type AudienceCandidate, type AudienceRow } from "./broadcast";

/**
 * Кому вообще можно разослать: клиенты из базы (кроме наших магазинов и
 * выключенных) и лиды (кроме закрытых отказом и уже ставших клиентами).
 * Читается сервером — и для экрана выбора, и заново при создании рассылки:
 * номера из браузера не принимаются (грабли 1.11).
 */
export async function loadAudience(options: { withOrders?: boolean } = {}): Promise<AudienceRow[]> {
  await prefetchTables([
    SHEET_TABS.CLIENTS,
    SHEET_TABS.LEADS,
    SHEET_TABS.BOT_CHATS,
    ...(options.withOrders ? [SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS] : []),
  ]);
  const [clients, leads, optedOut, orders] = await Promise.all([
    listClients(),
    listLeads(),
    optedOutKeys(),
    options.withOrders ? listOrdersWithItems() : Promise.resolve([]),
  ]);

  const lastOrder = new Map<string, string>();
  for (const o of orders) {
    if (!o.clientId || o.status === ORDER_STATUSES.CANCELLED) continue;
    const day = (o.createdAt || "").slice(0, 10);
    if (day > (lastOrder.get(o.clientId) ?? "")) lastOrder.set(o.clientId, day);
  }
  const today = new Date();
  const daysSince = (day: string | undefined) =>
    day ? Math.max(0, Math.floor((today.getTime() - Date.parse(`${day}T00:00:00`)) / 86400000)) : null;

  const candidates: AudienceCandidate[] = [
    ...clients
      .filter((c) => c.active && !(c.retail || "").trim())
      .map((c) => ({
        kind: "client" as const,
        refId: c.clientId,
        name: c.name,
        contactPerson: c.contactPerson,
        phone: c.phone,
        city: c.city,
        managerEmail: c.managerEmail,
        clientType: c.clientType,
        stage: "",
        campaign: "",
        segment: "",
        daysSinceOrder: options.withOrders ? daysSince(lastOrder.get(c.clientId)) : null,
      })),
    ...leads
      .filter((l) => l.stage !== "lost" && !l.clientId)
      .map((l) => ({
        kind: "lead" as const,
        refId: l.leadId,
        name: l.name,
        contactPerson: l.contactPerson,
        phone: l.phone,
        city: l.city,
        managerEmail: l.managerEmail,
        clientType: l.clientType,
        stage: l.stage,
        campaign: l.campaign,
        segment: l.segment,
        daysSinceOrder: null,
      })),
  ];
  return prepareAudience(candidates, optedOut);
}
