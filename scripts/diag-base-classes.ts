import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Кто есть кто в клиентской базе — на живых данных, только цифры (без имён и номеров клиентов). НИЧЕГО НЕ МЕНЯЕТ.
 * Сводит карточки, лиды и переписки всех номеров в одну запись на человека (`src/lib/baseClass.ts`) и печатает: сколько
 * кого, классы, чьи они, что не так с принадлежностью (менеджер ушёл, ничьи, продаёт или переписывается другой).
 *   npx tsx scripts/diag-base-classes.ts
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listClients } from "../src/lib/repo/clients";
import { listLeads, listLeadTouches } from "../src/lib/repo/leads";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listLeadAnalyses, listWaMessages } from "../src/lib/repo/talks";
import { listUsers } from "../src/lib/repo/users";
import { listWaLines } from "../src/lib/repo/waLines";
import { optedOutKeys, settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { latestByLead } from "../src/lib/talkAnalysis";
import { isNotASale } from "../src/lib/orderKind";
import { ORDER_STATUSES, ROLES } from "../src/lib/constants";
import { LEADS_LINE } from "../src/lib/broadcast";
import { localDayKey } from "../src/lib/timezone";
import { messageText } from "../src/lib/whatsapp";
import { BASE_CLASSES, BASE_CLASS_LABELS, BASE_KIND_LABELS, classifyBase, type BaseClass, type BaseEntry, type BaseKind } from "../src/lib/baseClass";

const n = (x: number) => String(x).padStart(6);
const money = (x: number) => `${Math.round(x / 1000).toLocaleString("ru-RU")} тыс. ₸`;
const count = <T,>(list: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

async function main() {
  await prefetchTables([SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.WA_MESSAGES, SHEET_TABS.LEAD_ANALYSES, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]);
  const [clients, leads, touches, orders, messages, analyses, users, lines, optedOut, map] = await Promise.all([
    listClients(), listLeads(), listLeadTouches(), listOrdersWithItems(), listWaMessages({ lines: "all" }), listLeadAnalyses(), listUsers(), listWaLines().catch(() => []), optedOutKeys(), settingsMap(),
  ]);
  const today = localDayKey();
  const sellerRoles = new Set<string>([ROLES.MANAGER, ROLES.SALES_HEAD, ROLES.ADMIN, ROLES.LEADGEN, ROLES.RETAIL_ALMATY, ROLES.RETAIL_REGIONS, ROLES.OFFICE_RETAIL]);
  const sellers = new Set(users.filter((u) => u.active && sellerRoles.has(u.role)).map((u) => u.email.trim().toLowerCase()));
  const nameOf = new Map(users.map((u) => [u.email.trim().toLowerCase(), (u.name || u.email).trim().split(/\s+/)[0]]));
  const zemfira = users.find((u) => u.active && u.role === ROLES.LEADGEN);
  const lineOwner = new Map<string, string>(lines.map((l) => [l.code, l.managerEmail.trim().toLowerCase()]));
  if (zemfira) lineOwner.set(LEADS_LINE, zemfira.email.trim().toLowerCase());
  const decisions = new Map(Array.from(latestByLead(analyses).entries()).map(([id, a]) => [id, a.decision || ""]));

  const res = classifyBase({
    cards: clients,
    leads,
    orders: orders
      .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && !(o.retail || "").trim() && o.createdAt)
      .map((o) => ({ clientId: o.clientId, clientPhone: o.clientPhone, managerEmail: o.managerEmail, day: localDayKey(new Date(o.createdAt)), amount: o.totalAmount || 0 })),
    messages: messages.map((m) => ({ phone: m.phone, at: m.at, direction: m.direction, line: m.line || "", text: m.direction === "in" ? messageText({ type: m.type || "text", text: m.text }) : "" })),
    touches: touches.map((t) => ({ leadId: t.leadId, outcome: t.outcome })),
    decisions,
    staff: await ourPhoneKeys(map),
    optedOut,
    sellers,
    lineOwner,
    today,
  });
  const E = res.entries;
  const who = (e: BaseEntry) => (e.ownerState === "none" ? "НИЧЕЙ" : `${nameOf.get(e.owner) ?? e.owner.split("@")[0]}${e.ownerState === "gone" ? " (ушёл)" : ""}`);

  console.log(`База на ${today}: карточек ${clients.length}, лидов ${leads.length}, сообщений WhatsApp ${messages.length}, заявок ${orders.length}`);
  console.log(`Людей в базе (одна запись на номер): ${E.length}`);
  console.log(`Вне базы: наших магазинов ${res.outside.shops}, номеров сотрудников ${res.outside.staff}; без телефона — карточек ${res.outside.noPhoneCards}, лидов ${res.outside.noPhoneLeads}`);

  console.log("\n=== КТО ЭТО ===");
  for (const [k, c] of count(E, (e) => e.kind)) console.log(`${n(c)}  ${BASE_KIND_LABELS[k as BaseKind]}`);

  console.log("\n=== В КАКОМ СОСТОЯНИИ ===");
  for (const cls of BASE_CLASSES) {
    const list = E.filter((e) => e.cls === cls);
    const rev = list.reduce((s, e) => s + e.revenue, 0);
    console.log(`${n(list.length)}  ${BASE_CLASS_LABELS[cls].padEnd(15)}${rev ? ` · куплено за всё время ${money(rev)}` : ""}`);
  }

  console.log("\n=== КТО × СОСТОЯНИЕ ===");
  for (const k of ["client", "card", "lead", "contact"] as BaseKind[]) {
    const list = E.filter((e) => e.kind === k);
    console.log(`${BASE_KIND_LABELS[k]} (${list.length}): ${count(list, (e) => e.cls).map(([c, x]) => `${BASE_CLASS_LABELS[c as BaseClass]} ${x}`).join(" · ")}`);
  }

  console.log("\n=== ЧЬИ (менеджер × состояние) ===");
  const owners = count(E, who);
  console.log(`${"".padEnd(22)}${BASE_CLASSES.map((c) => BASE_CLASS_LABELS[c].slice(0, 9).padStart(10)).join("")}${"всего".padStart(8)}`);
  for (const [o, total] of owners) {
    const list = E.filter((e) => who(e) === o);
    console.log(`${o.padEnd(22)}${BASE_CLASSES.map((c) => String(list.filter((e) => e.cls === c).length || "·").padStart(10)).join("")}${String(total).padStart(8)}`);
  }
  console.log(`Откуда известен хозяин: ${count(E.filter((e) => e.owner), (e) => ({ card: "карточка", lead: "лид", line: "номер переписки", "": "" })[e.ownerFrom]).map(([k, c]) => `${k} ${c}`).join(" · ")}`);

  console.log("\n=== ЧТО НЕ ТАК С ПРИНАДЛЕЖНОСТЬЮ ===");
  const buyers = E.filter((e) => e.kind === "client");
  const gone = E.filter((e) => e.ownerState === "gone");
  const none = E.filter((e) => e.ownerState === "none");
  console.log(`Менеджер ушёл: ${gone.length} (из них покупавших ${gone.filter((e) => e.kind === "client").length}, покупают сейчас ${gone.filter((e) => e.cls === "active").length}) — ${count(gone, who).map(([k, c]) => `${k} ${c}`).join(", ")}`);
  console.log(`Ничьи: ${none.length} — ${count(none, (e) => `${BASE_KIND_LABELS[e.kind]} / ${BASE_CLASS_LABELS[e.cls]}`).slice(0, 12).map(([k, c]) => `${k} ${c}`).join("; ")}`);
  const sold = E.filter((e) => e.soldBy);
  console.log(`Карточка у одного, а последние заявки оформляет другой: ${sold.length} — ${count(sold, (e) => `${nameOf.get(e.owner) ?? e.owner} → ${nameOf.get(e.soldBy) ?? e.soldBy}`).slice(0, 10).map(([k, c]) => `${k}: ${c}`).join("; ")}`);
  const chat = E.filter((e) => e.chatWith);
  console.log(`Записан за одним, а переписывается с номером другого: ${chat.length} — ${count(chat, (e) => `${nameOf.get(e.owner) ?? e.owner} → ${nameOf.get(e.chatWith) ?? e.chatWith}`).slice(0, 10).map(([k, c]) => `${k}: ${c}`).join("; ")}`);
  console.log(`Несколько карточек или лидов на один номер: ${E.filter((e) => e.duplicates > 0).length} человек`);
  console.log(`Карточка выключена: ${E.filter((e) => e.off).length} (из них покупали за 60 дней: ${E.filter((e) => e.off && (e.cls === "active" || e.cls === "cooling")).length})`);
  console.log(`Просили не писать («СТОП»): ${E.filter((e) => e.optOut).length} (из них покупавших ${E.filter((e) => e.optOut && e.kind === "client").length})`);
  console.log(`Написали последними и ждут ответа: ${E.filter((e) => e.waiting).length} — ${count(E.filter((e) => e.waiting), (e) => BASE_CLASS_LABELS[e.cls]).map(([k, c]) => `${k} ${c}`).join(", ")}`);

  console.log("\n=== ПОКУПАВШИЕ: деньги по состояниям и менеджерам ===");
  console.log(`Всего покупавших ${buyers.length}, куплено ${money(buyers.reduce((s, e) => s + e.revenue, 0))}`);
  for (const [o] of count(buyers, who)) {
    const list = buyers.filter((e) => who(e) === o);
    console.log(`${o.padEnd(22)} ${String(list.length).padStart(4)} чел. · ${money(list.reduce((s, e) => s + e.revenue, 0)).padStart(16)} · ${(["active", "cooling", "sleeping", "lost_client"] as BaseClass[]).map((c) => `${BASE_CLASS_LABELS[c]} ${list.filter((e) => e.cls === c).length}`).join(" · ")}`);
  }

  console.log("\n=== ЕЩЁ НЕ ПОКУПАЛИ: откуда ===");
  const prospects = E.filter((e) => e.kind !== "client");
  console.log(`Всего ${prospects.length}: из базы обзвона ${prospects.filter((e) => e.callBase).length}, с рекламы ${prospects.filter((e) => e.fromAds).length}, только переписка ${prospects.filter((e) => e.kind === "contact").length}`);
  console.log(`База обзвона: ${count(prospects.filter((e) => e.callBase), (e) => BASE_CLASS_LABELS[e.cls]).map(([k, c]) => `${k} ${c}`).join(" · ")}`);
  console.log(`С рекламы: ${count(prospects.filter((e) => e.fromAds), (e) => BASE_CLASS_LABELS[e.cls]).map(([k, c]) => `${k} ${c}`).join(" · ")}`);
  const lineName = (l: string) => (l === "" ? "основной" : l === LEADS_LINE ? "Земфира" : nameOf.get(lineOwner.get(l) || "") ?? l);
  console.log(`Только переписка, по номерам: ${count(E.filter((e) => e.kind === "contact").flatMap((e) => e.lines.map(lineName)), (x) => x).map(([k, c]) => `${k} ${c}`).join(" · ")}`);

  console.log("\n=== КТО РАБОТАЕТ С БАЗОЙ (сотрудники, за которыми кто-то записан) ===");
  const day = (iso: string) => (iso ? localDayKey(new Date(iso)) : "");
  const from30 = localDayKey(new Date(Date.now() - 30 * 86400000));
  const from7 = localDayKey(new Date(Date.now() - 7 * 86400000));
  const lineOf = new Map(Array.from(lineOwner.entries()).map(([code, email]) => [email, code]));
  for (const [email] of count(E.filter((e) => e.owner), (e) => e.owner)) {
    const u = users.find((x) => x.email.trim().toLowerCase() === email);
    const mine = touches.filter((t) => t.managerEmail.trim().toLowerCase() === email);
    const line = lineOf.get(email);
    const out = line === undefined ? null : messages.filter((m) => (m.line || "") === line && m.direction === "out");
    const ord = orders.filter((o) => o.managerEmail.trim().toLowerCase() === email && o.status !== ORDER_STATUSES.CANCELLED && day(o.createdAt) >= from30).length;
    console.log(
      `${(nameOf.get(email) ?? email.split("@")[0]).padEnd(12)} роль ${(u?.role ?? "нет в Users").padEnd(15)} ${u ? (u.active ? "работает" : "ВЫКЛЮЧЕН") : "—"} · касаний за 30 дн. ${mine.filter((t) => day(t.createdAt) >= from30).length}, за 7 дн. ${mine.filter((t) => day(t.createdAt) >= from7).length}, последнее ${mine.map((t) => day(t.createdAt)).sort().pop() || "никогда"} · заявок за 30 дн. ${ord} · WhatsApp ${out ? `${line}: исходящих за 7 дн. ${out.filter((m) => day(m.at) >= from7).length}` : "не подключён"}`
    );
  }
  console.log(`Сотрудники с номером WhatsApp, но без единой записи в базе: ${Array.from(lineOwner.entries()).filter(([, email]) => !E.some((e) => e.owner === email)).map(([code, email]) => `${nameOf.get(email) ?? email} (${code})`).join(", ") || "нет"}`);

  console.log("\n=== ЛИДЫ: стадии и причины отказа ===");
  console.log(`Стадии: ${count(leads, (l) => l.stage || "new").map(([k, c]) => `${k} ${c}`).join(" · ")}`);
  console.log(`Причины отказа: ${count(leads.filter((l) => l.stage === "lost"), (l) => l.lostReason || "(пусто)").map(([k, c]) => `${k} ${c}`).join(" · ") || "нет"}`);
  console.log(`Итоги звонков (все касания с итогом): ${count(touches.filter((t) => t.outcome), (t) => t.outcome).map(([k, c]) => `${k} ${c}`).join(" · ") || "нет"}`);
  const refused = E.filter((e) => e.cls === "refused");
  console.log(`«Отказался» (${refused.length}) — почему: «СТОП» ${refused.filter((e) => e.optOut).length}; лид закрыт отказом ${refused.filter((e) => e.leadIds.some((id) => leads.find((l) => l.leadId === id)?.stage === "lost")).length}; ИИ советует отказ ${refused.filter((e) => e.leadIds.some((id) => decisions.get(id) === "lost")).length}`);
  console.log(`Лиды с обзвонами: ${count(leads.filter((l) => l.campaign), (l) => l.campaign).map(([k, c]) => `${k} ${c}`).join(" · ")}`);
  console.log(`Лиды, с которыми нет ни касания, ни переписки, по давности заведения: ${count(E.filter((e) => e.cls === "untouched" && e.kind === "lead"), (e) => (leads.find((l) => l.leadId === e.leadIds[0])?.createdAt || "").slice(0, 7)).map(([k, c]) => `${k}: ${c}`).join(" · ")}`);

  console.log("\n=== ГОРОДА (первые 12) ===");
  console.log(count(E.filter((e) => e.city), (e) => e.city).slice(0, 12).map(([k, c]) => `${k} ${c}`).join(" · "));
  console.log(`Город не указан: ${E.filter((e) => !e.city).length}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
