import { prefetchTables, SHEET_TABS } from "./sheets";
import { localDayKey } from "./timezone";
import { listWaMessages } from "./repo/talks";
import { listUsers } from "./repo/users";
import { listClients } from "./repo/clients";
import { listLeads } from "./repo/leads";
import { listOrdersWithItems } from "./repo/orders";
import { listWaLines, managerLineConfig } from "./repo/waLines";
import { createBroadcast, listBroadcasts, listRecipients, optedOutKeys, settingsMap } from "./repo/broadcasts";
import { greenConfig, greenLeadsConfig } from "./greenApi";
import { ourPhoneKeys } from "./lineNotify";
import { chatFacts, sentFacts, type ExclusionContext } from "./autoBroadcast";
import { kickBroadcast } from "./autoBroadcastRunner";
import { SITE } from "./broadcastSend";
import { BROADCAST_STATUSES, greetingName, waPhone } from "./broadcast";
import { isClosedStage, phoneKey } from "./leads";
import { LEADS_LINE } from "./waLines";
import { looksLikeRefusal } from "./clientRefusal";
import { normalizeGrade } from "./botOrder";
import { pickNudgeOffers, type NudgeOffer } from "./botNudge";
import { priceFor, type PriceRow } from "./priceList";
import { parsePush, pushItemFor, SALES_PUSH_SETTING } from "./salesPush";
import { ROTATION_FILE } from "./botPhotos";
import { almatyHourOf } from "./officeStore";
import { MANAGER_PROFILES_SETTING, nextShipDay, parseManagerProfiles, profileOf, shipDayLabel } from "./managerProfile";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade, ORDER_STATUSES, ROLES } from "./constants";
import {
  broadcastCount,
  pickBroadcastContacts,
  staffBroadcastPlanText,
  staffBroadcastText,
  type ContactCandidate,
  type StaffBroadcastPlan,
} from "./staffBroadcast";
import type { StaffCommand, StaffItem } from "./staffCommand";
import type { AppUser } from "./types";

// Рассылка по просьбе менеджера — правила в `staffBroadcast.ts`.

const FOCUS_BUYERS_DAYS = 60;
const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";
const label = (o: Pick<NudgeOffer, "flowerType" | "variety" | "grade">) => `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
const n = (s: string) => (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");

/** Позиции для текста: названные сотрудником — со склада с ценой (сорт не назван — до двух самых больших сортов). */
export function focusOffers(items: StaffItem[], stock: { flower: string; variety: string; grade: string; qty: number }[], priceOf: (f: string, v: string, g: string) => number): NudgeOffer[] {
  const out: NudgeOffer[] = [];
  for (const it of items) {
    const grade = it.grade ? normalizeGrade(it.flowerType, it.grade) || it.grade : "";
    const rows = stock
      .filter((s) => s.flower === it.flowerType && s.qty >= 50 && (!grade || s.grade === grade) && (!it.variety || n(s.variety) === n(it.variety)))
      .map((s) => ({ flowerType: s.flower, variety: s.variety, grade: s.grade, qty: s.qty, price: priceOf(s.flower, s.variety, s.grade) }))
      .filter((o) => o.price > 0)
      .sort((a, b) => b.qty - a.qty);
    const take = it.variety ? 1 : 2;
    for (const o of rows) {
      if (out.length >= 3) break;
      if (rows.indexOf(o) >= take) break;
      if (!out.some((x) => x.flowerType === o.flowerType && x.variety === o.variety && x.grade === o.grade)) out.push(o);
    }
  }
  return out;
}

const itemTitle = (it: StaffItem) => [FLOWER_TYPE_LABELS[it.flowerType] ?? it.flowerType, it.variety, it.grade ? formatGrade(normalizeGrade(it.flowerType, it.grade) || it.grade) : ""].filter(Boolean).join(" ");

/** Собрать план (ничего не отправляя). `plan` пусто — собрать не из чего, в `reply` — почему. */
export async function planStaffBroadcast(
  command: StaffCommand,
  staff: AppUser | null,
  ctx: { prices: Map<string, PriceRow>; stock: { flower: string; variety: string; grade: string; qty: number }[] }
): Promise<{ reply: string; plan: StaffBroadcastPlan | null }> {
  if (!staff) return { reply: "Не узнал вас как сотрудника: ваш номер не записан в карточке («Настройки → Сотрудники»). Попросите владельца записать — и рассылка заработает.", plan: null };
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS]).catch(() => undefined);
  const [lines, messages, clients, leads, orders, broadcasts, recipients, optedOut, map] = await Promise.all([
    listWaLines().catch(() => []),
    listWaMessages({ lines: "all" }),
    listClients(),
    listLeads(),
    listOrdersWithItems(),
    listBroadcasts(),
    listRecipients(),
    optedOutKeys(),
    settingsMap(),
  ]);
  const email = staff.email.toLowerCase();

  // С какого номера: свой номер менеджера (Земфира — номер лидов), иначе основной.
  const own = lines.find((l) => l.active && l.managerEmail.toLowerCase() === email && managerLineConfig(l));
  const line = staff.role === ROLES.LEADGEN && greenLeadsConfig() ? LEADS_LINE : own ? own.code : "";
  if (!line && !greenConfig()) return { reply: "Не получилось: ни один номер WhatsApp сейчас не подключён.", plan: null };
  const via = line ? "вашего номера" : "основного номера (ваш номер WhatsApp в CRM не подключён)";

  // Что предлагать.
  const priceOf = (f: string, v: string, g: string) => priceFor(ctx.prices, f, v, g);
  const push = parsePush(map[SALES_PUSH_SETTING]);
  let offers = focusOffers(command.items, ctx.stock, priceOf);
  if (command.items.length && !offers.length) {
    return { reply: `Сейчас на складе нет (или нет цены): ${command.items.map(itemTitle).join(", ")} — рассылку не собираю. Назовите другую позицию.`, plan: null };
  }
  if (!offers.length) offers = pickNudgeOffers({ stock: ctx.stock, priceOf, mentioned: "", isLiquid: isLiquidGrade, isPush: (f, g) => !!pushItemFor(push, f, g) }).slice(0, 2);
  if (!offers.length && !command.text) return { reply: "На складе сейчас нечего предложить с ценой — рассылку не собираю.", plan: null };

  // Кому: собеседники номера, кто сам писал. С основного номера — только клиенты и лиды этого менеджера.
  const clientByKey = new Map<string, (typeof clients)[number]>();
  for (const c of clients) for (const p of [c.phone, c.messenger]) if (phoneKey(p) && !clientByKey.has(phoneKey(p))) clientByKey.set(phoneKey(p), c);
  const leadByKey = new Map<string, (typeof leads)[number]>();
  for (const l of leads) if (phoneKey(l.phone) && !leadByKey.has(phoneKey(l.phone))) leadByKey.set(phoneKey(l.phone), l);
  const from = localDayKey(new Date(Date.now() - FOCUS_BUYERS_DAYS * 86400000));
  const focus = command.items.map((it) => ({ f: it.flowerType, g: it.grade ? normalizeGrade(it.flowerType, it.grade) || it.grade : "", v: n(it.variety) }));
  const bought = new Set<string>();
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || localDayKey(new Date(o.createdAt)) < from) continue;
    if (!o.items.some((i) => focus.some((x) => i.flowerType === x.f && (!x.g || i.grade === x.g) && (!x.v || n(i.variety) === x.v)))) continue;
    if (o.clientId) bought.add(`c:${o.clientId}`);
    if (phoneKey(o.clientPhone)) bought.add(phoneKey(o.clientPhone));
  }
  const facts = chatFacts(messages);
  const byKey = new Map<string, { phone: string; lastInAt: string; sender: string }>();
  for (const m of messages) {
    if ((m.line || "") !== line) continue;
    const k = phoneKey(m.phone);
    if (!k) continue;
    const cur = byKey.get(k) ?? { phone: waPhone(m.phone), lastInAt: "", sender: "" };
    if (m.direction === "in" && m.at > cur.lastInAt) {
      cur.lastInAt = m.at;
      if ((m.senderName || "").trim()) cur.sender = m.senderName.trim();
    }
    byKey.set(k, cur);
  }
  const candidates: ContactCandidate[] = [];
  for (const [key, c] of Array.from(byKey.entries())) {
    if (!c.phone) continue;
    const client = clientByKey.get(key);
    const lead = client ? undefined : leadByKey.get(key);
    if (!line && (client?.managerEmail || lead?.managerEmail || "").toLowerCase() !== email) continue;
    const closed = client
      ? !client.active || (client.retail || "").trim()
        ? "наш магазин или выключенная карточка"
        : ""
      : lead && isClosedStage(lead.stage)
        ? "лид закрыт"
        : "";
    candidates.push({
      key,
      phone: c.phone,
      name: client ? greetingName(client.contactPerson, client.name) : lead ? (/^Клиент WhatsApp/i.test(lead.name.trim()) ? "" : greetingName(lead.contactPerson, lead.name)) : greetingName("", c.sender),
      kind: client ? "client" : lead ? "lead" : "contact",
      refId: client?.clientId || lead?.leadId || "",
      managerEmail: client?.managerEmail || lead?.managerEmail || staff.email,
      lastInAt: c.lastInAt,
      boughtFocus: bought.has(key) || (!!client && bought.has(`c:${client.clientId}`)),
      closed: closed || (looksLikeRefusal(facts.get(key)?.lastInText) ? "отказался в переписке" : ""),
    });
  }
  const autoOf = new Map(broadcasts.map((b) => [b.broadcastId, b.auto]));
  const exclusion: ExclusionContext = { now: new Date(), staff: await ourPhoneKeys(map), optedOut, facts, sent: sentFacts(recipients, autoOf) };
  const asked = broadcastCount(command.count);
  const { take, skipped } = pickBroadcastContacts(candidates, exclusion, asked);

  const profile = profileOf(parseManagerProfiles(map[MANAGER_PROFILES_SETTING]), staff.email);
  const shipDay = profile?.shipWeekday ? shipDayLabel(nextShipDay(localDayKey(), profile.shipWeekday, almatyHourOf(new Date()))) : "";
  const text = command.text || staffBroadcastText({ manager: firstName(staff.name), offers, label, shipDay });
  const focusTitle = command.items.length ? command.items.map(itemTitle).join(", ") : "ходовые позиции";
  if (!take.length) {
    const why = Object.entries(skipped).map(([w, k]) => `${w} — ${k}`).join("; ");
    return { reply: `Некому отправить: из ваших собеседников в WhatsApp никто сейчас не подходит${why ? ` (${why})` : ""}.`, plan: null };
  }
  const today = localDayKey();
  const plan: StaffBroadcastPlan = {
    at: new Date().toISOString(),
    line,
    via,
    title: `Поручение ${firstName(staff.name)} · ${focusTitle} · ${today.slice(8, 10)}.${today.slice(5, 7)}`,
    fileId: command.photo ? ROTATION_FILE : "",
    fileName: command.photo ? "Фото из ротации" : "",
    focus: focusTitle,
    recipients: take.map((c) => ({ phone: c.phone, name: c.name, kind: c.kind, refId: c.refId, managerEmail: c.managerEmail, text })),
  };
  return { reply: staffBroadcastPlanText({ plan, asked, skipped, withPhoto: command.photo }), plan };
}

/** «ДА» на план: рассылка «идёт», дальше её ведёт цепочка рассылок (темп и пределы номера). */
export async function runStaffBroadcastPlan(plan: StaffBroadcastPlan, staff: AppUser | null): Promise<string> {
  // За время ожидания с кем-то уже заговорили — им не шлём.
  const facts = chatFacts(await listWaMessages({ lines: "all", fresh: true }));
  const list = plan.recipients.filter((r) => (facts.get(phoneKey(r.phone))?.lastAt || "") <= plan.at);
  if (!list.length) return "Все из плана уже переписываются с вами — рассылку не запускаю.";
  await createBroadcast({
    createdByEmail: staff?.email || "staff",
    title: plan.title,
    text: list[0].text,
    fileId: plan.fileId,
    fileName: plan.fileName,
    audience: `По просьбе ${firstName(staff?.name || "") || "сотрудника"} в WhatsApp: тёплые контакты (${list.length})`,
    recipients: list,
    line: plan.line,
    status: BROADCAST_STATUSES.SENDING,
  });
  await kickBroadcast(SITE()).catch(() => undefined);
  const late = almatyHourOf(new Date()) >= 19;
  const dropped = plan.recipients.length - list.length;
  return [
    `Запустил: *${list.length}* с ${plan.via.replace(/ \(.*\)$/, "")}${dropped ? ` (${dropped} убрал — с ними уже переписка)` : ""}.`,
    late
      ? "Сейчас уже вечер — отправка пойдёт завтра с 10:00, с паузами."
      : "Уходит постепенно, с паузами 1–2 минуты и перерывами (до 20 в час, с 10 до 19), — чтобы номер не заблокировали.",
    plan.line ? "Ответы придут в ваш WhatsApp; если вы молчите, ответит ИИ-помощник." : "Ответы придут на основной номер, отвечает бот.",
  ].join("\n");
}
