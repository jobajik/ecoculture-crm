import { ROLES } from "./constants";
import { canSeeLead, canUseLeads, stageLabel } from "./leads";
import { orderCode } from "./paymentStage";
import { orderStage } from "./orderStage";
import { formatDay } from "./formatDate";
import { isOwnShop } from "./retail";
import type { Client, Lead, OrderWithItems } from "./types";

/**
 * Общий поиск по сайту (Ctrl K) — одно поле на клиентов, заявки и лиды (19.10.2026, макет принят владельцем:
 * «ввёл номер телефона, кусок названия или номер заявки — и попал куда надо, не думая, в каком разделе это лежит»).
 *
 * Чистая функция: заявки ей отдают УЖЕ отфильтрованные по роли (`visibleOrdersFor`), клиентов и лиды она режет
 * сама теми же правилами, что страницы (`canSeeLead`, список клиентов — тем, кто продаёт). Телефон сравнивается по
 * цифрам: «+7 701…», «8 701…» и «701…» находят одно и то же.
 */
export interface SearchHit {
  kind: "client" | "order" | "lead";
  title: string;
  subtitle: string;
  href: string;
  /** Короткая метка справа: этап заявки, стадия лида, долг клиента. */
  pill?: string;
  tone?: "good" | "wait" | "bad" | "muted";
}

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_LIMIT = 8;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
const digits = (s: string) => s.replace(/\D/g, "");

/** Цифры запроса для поиска по телефону: от четырёх цифр, «8…» читается как «7…». */
function phoneQuery(q: string): string {
  const d = digits(q);
  if (d.length < 4 || d.length !== q.replace(/[\s()+-]/g, "").length) return "";
  return d.startsWith("8") && d.length >= 5 ? `7${d.slice(1)}` : d;
}

function phoneHit(phone: string | null | undefined, pq: string): boolean {
  if (!pq) return false;
  const pd = digits(phone || "");
  return pd.includes(pq);
}

/** Клиентскую базу видят те, кто продаёт; менеджер розницы — только свои магазины (карточки клиентов — через заявки). */
export function canSearchClients(role: string | null | undefined): boolean {
  return role === ROLES.MANAGER || role === ROLES.SALES_HEAD || role === ROLES.ACCOUNTANT || role === ROLES.ADMIN;
}

export function searchEverything(
  query: string,
  data: { clients: Client[]; orders: OrderWithItems[]; leads: Lead[] },
  user: { role?: string | null; email?: string | null },
  today: string
): SearchHit[] {
  const q = norm(query);
  if (q.length < SEARCH_MIN_LENGTH) return [];
  const pq = phoneQuery(query);
  const role = user.role ?? undefined;
  const email = (user.email ?? "").toLowerCase();
  const hits: { hit: SearchHit; score: number }[] = [];

  const textScore = (s: string | null | undefined) => {
    const v = norm(s || "");
    if (!v) return 0;
    if (v === q) return 3;
    if (v.startsWith(q)) return 2;
    if (v.includes(q)) return 1;
    return 0;
  };

  if (canSearchClients(role)) {
    for (const c of data.clients) {
      if (!c.active || isOwnShop(c)) continue;
      const s = Math.max(textScore(c.name), textScore(c.shopName), textScore(c.contactPerson) * 0.8, phoneHit(c.phone, pq) || phoneHit(c.messenger, pq) ? 2.5 : 0);
      if (s === 0) continue;
      hits.push({
        hit: {
          kind: "client",
          title: c.name,
          subtitle: [c.city, c.clientType].filter(Boolean).join(" · "),
          href: `/clients/${encodeURIComponent(c.clientId)}`,
        },
        score: s + 1,
      });
    }
  }

  for (const o of data.orders) {
    const code = orderCode(o.orderId).toLowerCase();
    const qc = q.replace(/[\s-]/g, "").replace(/^№/, "");
    const codeScore = qc.length >= 3 && code.includes(qc) ? (code === qc ? 3 : 2) : 0;
    const s = Math.max(codeScore, textScore(o.clientName), phoneHit(o.clientPhone, pq) ? 2 : 0, o.items.some((i) => textScore(i.variety) > 0) ? 0.5 : 0);
    if (s === 0) continue;
    const stage = orderStage(o, today);
    const tone = stage.lateDays > 0 ? "bad" : stage.tone === "done" || stage.tone === "ready" ? "good" : stage.tone === "wait" ? "wait" : "muted";
    hits.push({
      hit: {
        kind: "order",
        title: `№ ${orderCode(o.orderId)} · ${o.clientName || "без клиента"}`,
        subtitle: [o.deliveryDate ? formatDay(o.deliveryDate) : "без даты", `${Math.round(o.totalAmount).toLocaleString("ru-RU")} ₸`].join(" · "),
        href: `/orders/${encodeURIComponent(o.orderId)}`,
        pill: stage.lateDays > 0 ? `опаздывает ${stage.lateDays} дн.` : stage.label,
        tone,
      },
      score: s + (codeScore > 0 ? 1 : 0),
    });
  }

  if (canUseLeads(role)) {
    for (const l of data.leads) {
      if (!canSeeLead(role, email, l)) continue;
      const s = Math.max(textScore(l.name), textScore(l.contactPerson) * 0.8, phoneHit(l.phone, pq) ? 2.5 : 0);
      if (s === 0) continue;
      hits.push({
        hit: {
          kind: "lead",
          title: l.name || `Лид ${l.phone}`,
          subtitle: [l.city, l.nextTouchAt ? `касание ${formatDay(l.nextTouchAt)}` : ""].filter(Boolean).join(" · "),
          href: `/clients/leads/${encodeURIComponent(l.leadId)}`,
          pill: stageLabel(l.stage),
          tone: "muted",
        },
        score: s,
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title, "ru"))
    .slice(0, SEARCH_LIMIT)
    .map((h) => h.hit);
}
