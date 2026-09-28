import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import {
  latestBroadcastAnalyses,
  listBroadcasts,
  listRecipients,
  listWaStatuses,
  optedOutKeys,
  type StoredBroadcastAnalysis,
} from "@/lib/repo/broadcasts";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listLeads } from "@/lib/repo/leads";
import { ordersAfterBroadcast, type BroadcastOrders, type OrderLite } from "@/lib/broadcastAnalysis";
import { listWaMessages } from "@/lib/repo/talks";
import { mergeMessages } from "@/lib/whatsapp";
import { broadcastTotals, deliveryByMessage, recipientViews, type BroadcastTotals, type RecipientView } from "@/lib/broadcast";
import { getInstanceState, greenConfig } from "@/lib/greenApi";
import { greenStateText } from "@/lib/greenOut";
import type { Broadcast } from "@/lib/repo/broadcasts";

/** Всё для страниц рассылок — одним batchGet (грабли 1.17). */
export async function loadBroadcastData(): Promise<{
  broadcasts: (Broadcast & { totals: BroadcastTotals; results: BroadcastOrders; analysis: StoredBroadcastAnalysis | null })[];
  views: RecipientView[];
  optedOut: Set<string>;
}> {
  await prefetchTables([
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.WA_STATUSES,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.BOT_CHATS,
    SHEET_TABS.BROADCAST_ANALYSES,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.LEADS,
  ]);
  const [broadcasts, recipients, statuses, messages, optedOut, analyses, orders, leads] = await Promise.all([
    listBroadcasts(),
    listRecipients(),
    listWaStatuses(),
    listWaMessages(),
    optedOutKeys(),
    latestBroadcastAnalyses(),
    listOrdersWithItems().catch(() => []),
    listLeads().catch(() => []),
  ]);
  const views = recipientViews(recipients, deliveryByMessage(statuses), mergeMessages(messages));
  const lite: OrderLite[] = orders.map((o) => ({
    orderId: o.orderId,
    clientId: o.clientId,
    clientName: o.clientName,
    createdAt: o.createdAt,
    status: o.status,
    amount: o.totalAmount,
  }));
  const leadClient = new Map(leads.filter((l) => l.clientId).map((l) => [l.leadId, l.clientId]));
  return {
    broadcasts: broadcasts.map((b) => {
      const mine = views.filter((v) => v.broadcastId === b.broadcastId);
      return {
        ...b,
        totals: broadcastTotals(mine, optedOut),
        results: ordersAfterBroadcast(mine, lite, leadClient),
        analysis: analyses.get(b.broadcastId) ?? null,
      };
    }),
    views,
    optedOut,
  };
}

export interface ChannelInfo {
  ok: boolean;
  text: string;
}

/** Состояние WhatsApp в Green API — одной строкой для шапки. Никогда не бросает. */
export async function channelInfo(): Promise<ChannelInfo> {
  const cfg = greenConfig();
  if (!cfg) return { ok: false, text: "WhatsApp (Green API) не подключён — ключи вводятся в whatsapp-key.bat" };
  try {
    const state = await getInstanceState(cfg);
    return state === "authorized"
      ? { ok: true, text: "WhatsApp работает (Green API)" }
      : { ok: false, text: `WhatsApp: ${greenStateText(state)}` };
  } catch {
    return { ok: false, text: "Green API не ответил — обновите страницу через минуту" };
  }
}
