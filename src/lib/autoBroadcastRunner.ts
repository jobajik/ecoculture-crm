import { randomUUID } from "node:crypto";
import { commitAtomic, prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { localDayKey } from "./timezone";
import {
  broadcastUpdate,
  createBroadcast,
  listBroadcastRows,
  listBroadcasts,
  listRecipients,
  optedOutKeys,
  settingsMap,
} from "./repo/broadcasts";
import { getSettings, saveSettings } from "./repo/settings";
import { listLeads } from "./repo/leads";
import { listLeadAnalyses, listWaMessages } from "./repo/talks";
import { listClients } from "./repo/clients";
import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { listWaLines } from "./repo/waLines";
import { listSellableBatches } from "./repo/sellable";
import { getCurrentPrices } from "./repo/prices";
import { greenConfig, greenLeadsConfig, sendText } from "./greenApi";
import { checkGreenChannel } from "./greenChannel";
import { managerLineConfig } from "./repo/waLines";
import { sendNextBroadcastMessage, SITE, type SendStep } from "./broadcastSend";
import { BROADCAST_STATUSES, LEADS_LINE, effectiveDailyLimit, greetingName, waPhone } from "./broadcast";
import { phoneKey } from "./leads";
import { latestByLead } from "./talkAnalysis";
import { stockMap } from "./botKnowledge";
import { inStore } from "./officeStore";
import { priceFor } from "./priceList";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade, ORDER_STATUSES } from "./constants";
import { isNotASale } from "./orderKind";
import { parsePush, pushItemFor, pushLines, SALES_PUSH_SETTING } from "./salesPush";
import { pickNudgeOffers, type NudgeOffer } from "./botNudge";
import { staffPhoneKeys } from "./botSalesAlert";
import { DIGEST_SETTING, digestPhones } from "./morningDigest";
import { ROTATION_FILE } from "./botPhotos";
import { genitiveName, isManagerLine } from "./waLines";
import {
  AUTO_AUTHOR,
  AUTO_CAPS,
  AUTO_MAIN_MAX,
  AUTO_PLAN_SETTING,
  AUTO_RULE_LABELS,
  AUTO_SETTING,
  CHAIN_SETTING,
  EMPTY_PLAN,
  FRESH_WARM_DAYS,
  FRESH_WEEKDAY,
  PUSH_BUYERS_DAYS,
  activateAtFor,
  activationDue,
  almatyParts,
  chainBusy,
  chainWait,
  chatFacts,
  commonExclusion,
  freshText,
  isSleeping,
  leadReminderText,
  orderedRecently,
  parseAutoConfig,
  parseChainLock,
  parsePlanRecord,
  pickLeadReminders,
  planDue,
  planMessageText,
  planRecordValue,
  pushText,
  sentFacts,
  sleepingText,
  type AutoRule,
  type ClientHistory,
  type ExclusionContext,
  type PlanPart,
  type PlanRecord,
} from "./autoBroadcast";

// ---------------------------------------------------------------------------
// Автопилот рассылок: собрать план дня, запустить его в 10:00, остановить по «ОТМЕНА» и вести отправку
// на сайте без компьютера (цепочка `/api/broadcast/auto`). Правила — `autoBroadcast.ts`.
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set<string>([BROADCAST_STATUSES.DRAFT, BROADCAST_STATUSES.SENDING, BROADCAST_STATUSES.PAUSED]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dmy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";
const label = (o: Pick<NudgeOffer, "flowerType" | "variety" | "grade">) =>
  `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
const normGrade = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

interface Recipient {
  phone: string;
  name: string;
  kind: string;
  refId: string;
  managerEmail: string;
  text: string;
}

export interface BroadcastSpec {
  rule: AutoRule;
  line: string;
  lineLabel: string;
  fileId: string;
  fileName: string;
  audience: string;
  recipients: Recipient[];
}

export interface BuiltPlan {
  specs: BroadcastSpec[];
  waiting: number;
  skipped: Partial<Record<AutoRule, Record<string, number>>>;
}

/** Собрать план на сегодня, ничего не записывая. */
export async function buildAutoPlan(now: Date = new Date()): Promise<BuiltPlan> {
  await prefetchTables([
    SHEET_TABS.LEADS,
    SHEET_TABS.LEAD_ANALYSES,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.BOT_CHATS,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.BATCHES,
    SHEET_TABS.PRICE_HISTORY,
  ]);
  const [map, leads, analyses, messages, broadcasts, recipients, optedOut, clients, orders, batches, shelf, prices, users, lines] = await Promise.all([
    settingsMap(),
    listLeads(),
    listLeadAnalyses(),
    listWaMessages({ lines: "all" }),
    listBroadcasts(),
    listRecipients(),
    optedOutKeys(),
    listClients(),
    listOrdersWithItems(),
    listSellableBatches(),
    getSettings(),
    getCurrentPrices(),
    listUsers().catch(() => []),
    listWaLines().catch(() => []),
  ]);
  const cfg = parseAutoConfig(map[AUTO_SETTING]);
  const today = almatyParts(now).day;
  const weekday = almatyParts(now).weekday;
  const toDay = (iso: string) => (iso ? localDayKey(new Date(iso)) : "");
  const autoOf = new Map(broadcasts.map((b) => [b.broadcastId, b.auto]));
  const ctx: ExclusionContext = {
    now,
    staff: staffPhoneKeys(map),
    optedOut,
    facts: chatFacts(messages),
    sent: sentFacts(recipients, autoOf),
  };
  const taken = new Set<string>();
  const specs: BroadcastSpec[] = [];
  const skipped: BuiltPlan["skipped"] = {};
  const skip = (rule: AutoRule, why: string) => {
    const r = (skipped[rule] ??= {});
    r[why] = (r[why] ?? 0) + 1;
  };

  // Склад на завтра — основной; цены — прайс клиента.
  const stock = Array.from(stockMap(inStore(batches, ""), shelf, now).values());
  const priceOf = (f: string, v: string, g: string) => priceFor(prices, f, v, g);
  const push = parsePush(map[SALES_PUSH_SETTING]);
  const isPush = (f: string, g: string) => !!pushItemFor(push, f, g);
  const offersFor = (mentioned: string, onlyFlowers?: Set<string>) =>
    pickNudgeOffers({
      stock: onlyFlowers && onlyFlowers.size ? stock.filter((s) => onlyFlowers.has(s.flower)) : stock,
      priceOf,
      mentioned,
      isLiquid: isLiquidGrade,
      isPush,
    });
  const userName = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.name]));

  // --- Лиды: с того номера, где шла переписка --------------------------------------------------------------
  let waiting = 0;
  if (cfg.rules.leads) {
    const lineOf = new Map(lines.map((l) => [l.code, l]));
    const lineOk = (line: string) =>
      line === "" ? !!greenConfig() : line === LEADS_LINE ? !!greenLeadsConfig() : isManagerLine(line) ? !!managerLineConfig(lineOf.get(line)) : false;
    const zemfira = users.find((u) => u.active && u.role === "leadgen");
    const managerOfLine = (line: string) =>
      line === LEADS_LINE ? firstName(zemfira?.name || "") : isManagerLine(line) ? firstName(userName.get((lineOf.get(line)?.managerEmail || "").toLowerCase()) || "") : "";
    const picked = pickLeadReminders({ leads, analyses: latestByLead(analyses), ctx, today, lineOk, toDay });
    waiting = picked.waiting.length;
    for (const [why, n] of Object.entries(picked.skipped)) for (let i = 0; i < n; i++) skip("leads", why);
    const byLine = new Map<string, Recipient[]>();
    for (const p of picked.take) {
      const placeholder = /^Клиент WhatsApp/i.test(p.lead.name.trim());
      const text = leadReminderText({ draft: p.draft, manager: managerOfLine(p.line), offers: p.draft ? [] : offersFor(""), label });
      byLine.set(p.line, [
        ...(byLine.get(p.line) ?? []),
        { phone: p.phone, name: placeholder ? "" : greetingName(p.lead.contactPerson, p.lead.name), kind: "lead", refId: p.lead.leadId, managerEmail: p.lead.managerEmail, text },
      ]);
      taken.add(phoneKey(p.phone));
    }
    for (const [line, list] of Array.from(byLine.entries())) {
      const who = managerOfLine(line);
      const lineLabel = line === "" ? "рабочий номер" : who ? `номер ${genitiveName(who)}` : line === LEADS_LINE ? "номер лидов" : `номер ${line}`;
      specs.push({ rule: "leads", line, lineLabel, fileId: "", fileName: "", audience: `Автопилот: лиды с касанием на сегодня или просроченным (${list.length})`, recipients: list });
    }
  }

  // --- Клиенты: история заказов ----------------------------------------------------------------------------
  const history = new Map<string, ClientHistory>();
  const pushFrom = localDayKey(new Date(now.getTime() - PUSH_BUYERS_DAYS * 86400000));
  const sales = orders
    .filter((o) => o.clientId && o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && !(o.retail || "").trim() && o.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const clientById = new Map(clients.map((c) => [c.clientId, c]));
  for (const o of sales) {
    const c = clientById.get(o.clientId);
    if (!c || !c.active || (c.retail || "").trim()) continue;
    const day = toDay(o.createdAt);
    const h =
      history.get(c.clientId) ??
      ({ clientId: c.clientId, name: c.name, contactPerson: c.contactPerson, phone: waPhone(c.phone) || waPhone(o.clientPhone), managerEmail: c.managerEmail, days: [], revenue: 0, lastItems: [], recentGrades: new Set(), flowers: new Set() } as ClientHistory);
    if (!h.days.includes(day)) h.days.push(day);
    h.revenue += o.totalAmount || 0;
    const items = o.items.filter((i) => i.quantity > 0);
    if (items.length) h.lastItems = items.map((i) => ({ flowerType: i.flowerType, variety: i.variety, grade: i.grade, quantity: i.quantity }));
    for (const i of items) {
      h.flowers.add(i.flowerType);
      if (day >= pushFrom) h.recentGrades.add(`${i.flowerType}|${normGrade(i.grade)}`);
    }
    history.set(c.clientId, h);
  }
  const clientsList = Array.from(history.values()).filter((h) => h.phone);

  const mainLimit = Math.min(AUTO_MAIN_MAX, effectiveDailyLimit(map.BroadcastDailyLimit, map.BroadcastWarmupFrom, today));
  let mainLeft = mainLimit;
  const okClient = (rule: AutoRule, h: ClientHistory): boolean => {
    const key = phoneKey(h.phone);
    if (taken.has(key)) return false;
    if (orderedRecently(h.days, today)) {
      skip(rule, "заказывал за 3 дня");
      return false;
    }
    const why = commonExclusion(key, ctx);
    if (why) {
      skip(rule, why);
      return false;
    }
    return true;
  };
  const mainSpec = (rule: AutoRule, list: Recipient[], audience: string, rotation: boolean) => {
    if (!list.length) return;
    specs.push({ rule, line: "", lineLabel: "", fileId: rotation ? ROTATION_FILE : "", fileName: rotation ? "Фото из ротации" : "", audience, recipients: list });
  };
  const asRecipient = (h: ClientHistory, text: string): Recipient => ({
    phone: h.phone,
    name: greetingName(h.contactPerson, h.name),
    kind: "client",
    refId: h.clientId,
    managerEmail: h.managerEmail,
    text,
  });

  // --- Давно не заказывали ----------------------------------------------------------------------------------
  if (cfg.rules.sleeping) {
    const list: Recipient[] = [];
    const due = clientsList.filter((h) => isSleeping(h.days, today)).sort((a, b) => b.revenue - a.revenue);
    for (const h of due) {
      if (list.length >= Math.min(AUTO_CAPS.sleeping, mainLeft)) break;
      if (!okClient("sleeping", h)) continue;
      // Что брал в прошлый раз — две самые большие позиции; предложение — те же позиции со склада или та же категория.
      const last = [...h.lastItems].sort((a, b) => b.quantity - a.quantity).slice(0, 2);
      const offers: NudgeOffer[] = [];
      for (const it of last) {
        const same = stock.find((s) => s.flower === it.flowerType && s.variety === it.variety && s.grade === it.grade && s.qty >= 50 && priceOf(s.flower, s.variety, s.grade) > 0);
        const alike = same ?? stock.filter((s) => s.flower === it.flowerType && s.grade === it.grade && s.qty >= 50 && priceOf(s.flower, s.variety, s.grade) > 0).sort((a, b) => b.qty - a.qty)[0];
        if (alike && !offers.some((o) => o.flowerType === alike.flower && o.variety === alike.variety && o.grade === alike.grade)) {
          offers.push({ flowerType: alike.flower, variety: alike.variety, grade: alike.grade, qty: alike.qty, price: priceOf(alike.flower, alike.variety, alike.grade) });
        }
      }
      const finalOffers = offers.length ? offers : offersFor(last.map((l) => l.variety).join(" "), h.flowers);
      if (!finalOffers.length) {
        skip("sleeping", "нечего предложить со склада");
        continue;
      }
      list.push(asRecipient(h, sleepingText({ last: last.map((l) => ({ label: label(l), quantity: l.quantity })), offers: finalOffers, label })));
      taken.add(phoneKey(h.phone));
    }
    mainLeft -= list.length;
    mainSpec("sleeping", list, `Автопилот: клиенты, которые молчат дольше обычного (${list.length})`, false);
  }

  // --- Распродажа — тем, кто уже брал эту позицию ------------------------------------------------------------
  if (cfg.rules.push && push.length) {
    const list: Recipient[] = [];
    for (const line of pushLines(push, stock, priceOf).filter((l) => l.qty >= 100 && l.varieties.some((v) => v.price > 0))) {
      const key = `${line.flowerType}|${normGrade(line.grade)}`;
      const buyers = clientsList.filter((h) => h.recentGrades.has(key)).sort((a, b) => b.revenue - a.revenue);
      for (const h of buyers) {
        if (list.length >= Math.min(AUTO_CAPS.push, mainLeft)) break;
        if (!okClient("push", h)) continue;
        list.push(asRecipient(h, pushText(line)));
        taken.add(phoneKey(h.phone));
      }
    }
    mainLeft -= list.length;
    mainSpec("push", list, `Автопилот: распродажа — тем, кто уже брал (${list.length})`, true);
  }

  // --- Свежий срез — по понедельникам, тёплым ---------------------------------------------------------------
  if (cfg.rules.fresh && weekday === FRESH_WEEKDAY) {
    const list: Recipient[] = [];
    const warmFrom = localDayKey(new Date(now.getTime() - FRESH_WARM_DAYS * 86400000));
    const wroteUs = new Set(messages.filter((m) => !m.line && m.direction === "in" && toDay(m.at) >= warmFrom).map((m) => phoneKey(m.phone)));
    const warm = clientsList
      .filter((h) => h.days[h.days.length - 1] >= warmFrom || wroteUs.has(phoneKey(h.phone)))
      .sort((a, b) => (b.days[b.days.length - 1] || "").localeCompare(a.days[a.days.length - 1] || ""));
    for (const h of warm) {
      if (list.length >= Math.min(AUTO_CAPS.fresh, mainLeft)) break;
      if (!okClient("fresh", h)) continue;
      const offers = offersFor(h.lastItems.map((l) => l.variety).join(" "), h.flowers);
      if (!offers.length) {
        skip("fresh", "нечего предложить со склада");
        continue;
      }
      list.push(asRecipient(h, freshText(offers, label)));
      taken.add(phoneKey(h.phone));
    }
    mainLeft -= list.length;
    mainSpec("fresh", list, `Автопилот: свежий срез тёплым клиентам (${list.length})`, true);
  }

  return { specs, waiting, skipped };
}

// --- План: собрать, запустить, остановить ---------------------------------------------------------------------

async function cancelRows(rows: { broadcast: { broadcastId: string }; rowNumber: number }[], note: string): Promise<number> {
  if (!rows.length) return 0;
  const at = new Date().toISOString();
  const writes: WriteOp[] = rows.map((r) => broadcastUpdate(r.rowNumber, { Status: BROADCAST_STATUSES.CANCELLED, FinishedAt: at, Note: note }));
  await commitAtomic(writes);
  return rows.length;
}

export interface PlanResult {
  plan: PlanRecord;
  created: number;
  messages: number;
  notified: number;
  note: string;
}

/** Собрать план дня и (по умолчанию) прислать его владельцу. `force` — пересобрать сегодняшний, пока он не запущен. */
export async function planAutoBroadcasts(options: { now?: Date; force?: boolean; notify?: boolean } = {}): Promise<PlanResult> {
  const now = options.now ?? new Date();
  const today = almatyParts(now).day;
  const map = await settingsMap(true);
  const prev = parsePlanRecord(map[AUTO_PLAN_SETTING]);
  const rows = await listBroadcastRows(true);

  // Вчерашнее недоотправленное не досылаем: тексты и цены были на тот день.
  await cancelRows(
    rows.filter((r) => r.broadcast.auto && r.broadcast.plannedFor && r.broadcast.plannedFor < today && ACTIVE_STATUSES.has(r.broadcast.status)),
    "План автопилота на прошлый день — не досылаем"
  );
  if (prev.day === today && !options.force) return { plan: prev, created: 0, messages: 0, notified: 0, note: "план на сегодня уже есть" };
  if (prev.day === today && prev.activated && !prev.cancelled) throw new Error("Сегодняшний план уже отправляется — сначала остановите его");
  if (prev.day === today) {
    await cancelRows(
      rows.filter((r) => r.broadcast.auto && r.broadcast.plannedFor === today && ACTIVE_STATUSES.has(r.broadcast.status)),
      "План пересобран"
    );
  }

  const built = await buildAutoPlan(now);
  const ids: string[] = [];
  const counts: PlanRecord["counts"] = {};
  const parts: PlanPart[] = [];
  for (const s of built.specs) {
    const title = `Авто · ${AUTO_RULE_LABELS[s.rule]}${s.lineLabel && s.line ? ` · ${s.lineLabel}` : ""} · ${dmy(today)}`;
    const id = await createBroadcast({
      createdByEmail: AUTO_AUTHOR,
      title,
      text: s.recipients[0]?.text || "",
      fileId: s.fileId,
      fileName: s.fileName,
      audience: s.audience,
      recipients: s.recipients,
      line: s.line,
      status: BROADCAST_STATUSES.DRAFT,
      auto: s.rule,
      plannedFor: today,
    });
    ids.push(id);
    counts[s.rule] = (counts[s.rule] ?? 0) + s.recipients.length;
    parts.push({ rule: s.rule, lineLabel: s.line ? s.lineLabel : "", count: s.recipients.length, sample: s.recipients[0]?.text || "" });
  }
  const total = parts.reduce((x, p) => x + p.count, 0);
  const activateAt = activateAtFor(now);
  const plan: PlanRecord = {
    day: today,
    at: now.toISOString(),
    activateAt,
    ids,
    counts,
    activated: false,
    cancelled: false,
    cancelledBy: "",
    note: total ? `${total} сообщ.` : "сегодня слать некому",
  };
  await saveSettings({ [AUTO_PLAN_SETTING]: planRecordValue(plan) });

  let notified = 0;
  if (options.notify !== false && total > 0) {
    const text = planMessageText({ parts, activateAt, link: `${SITE()}/clients/broadcasts/auto`, waiting: built.waiting });
    notified = await sendToStaff(map, text);
  }
  return { plan, created: ids.length, messages: total, notified, note: plan.note };
}

/** Сообщение на номера утренней сводки (там владелец). Сбой — 0, план от этого не зависит. */
async function sendToStaff(map: Record<string, string>, text: string): Promise<number> {
  const phones = digestPhones(map[DIGEST_SETTING]).map(waPhone).filter(Boolean);
  if (!phones.length) return 0;
  const channel = await checkGreenChannel();
  if (channel.action !== "ok" || !channel.cfg) return 0;
  let n = 0;
  for (const p of phones) {
    try {
      await sendText(channel.cfg, p, text, { linkPreview: false });
      n += 1;
    } catch (err) {
      console.error("auto plan notify:", err instanceof Error ? err.message : err);
    }
  }
  return n;
}

/** В 10:00 (или позже, если план собран поздно) — черновики плана в «идёт». */
export async function activateDuePlan(now: Date = new Date()): Promise<number> {
  const map = await settingsMap(true);
  const plan = parsePlanRecord(map[AUTO_PLAN_SETTING]);
  if (!activationDue(now, plan)) return 0;
  const rows = (await listBroadcastRows(true)).filter((r) => plan.ids.includes(r.broadcast.broadcastId) && r.broadcast.status === BROADCAST_STATUSES.DRAFT);
  const at = now.toISOString();
  if (rows.length) await commitAtomic(rows.map((r) => broadcastUpdate(r.rowNumber, { Status: BROADCAST_STATUSES.SENDING, StartedAt: at, Note: "" })));
  await saveSettings({ [AUTO_PLAN_SETTING]: planRecordValue({ ...plan, activated: true }) });
  return rows.length;
}

/** «ОТМЕНА» или кнопка «Остановить сегодня»: всё сегодняшнее автопилота — «остановлена». */
export async function cancelTodayAuto(by: string, now: Date = new Date()): Promise<number> {
  const today = almatyParts(now).day;
  const map = await settingsMap(true);
  const plan = parsePlanRecord(map[AUTO_PLAN_SETTING]);
  const rows = (await listBroadcastRows(true)).filter((r) => r.broadcast.auto && r.broadcast.plannedFor === today && ACTIVE_STATUSES.has(r.broadcast.status));
  const n = await cancelRows(rows, `Остановлено: ${by}`);
  // Остановили до плана — сегодня его уже не собираем.
  const base = plan.day === today ? plan : { ...EMPTY_PLAN, day: today, at: now.toISOString() };
  await saveSettings({ [AUTO_PLAN_SETTING]: planRecordValue({ ...base, cancelled: true, cancelledBy: by }) });
  return n;
}

/** Ответ сотрудника на план. Возвращает текст подтверждения. */
export async function cancelFromWhatsApp(phone: string): Promise<string> {
  const n = await cancelTodayAuto(`ответ «отмена» с …${phone.replace(/\D/g, "").slice(-4)}`);
  return n > 0
    ? `Хорошо, сегодняшние авторассылки остановлены (${n}). Завтра утром пришлю новый план.`
    : "Сегодня авторассылок нет — останавливать нечего.";
}

// --- Цепочка отправки ------------------------------------------------------------------------------------------

/** Сколько функция может ждать до следующего шага (живёт минуту): дольше — отпускаем, разбудят вебхуки и расписание. */
const MAX_SLEEP_S = 50;
const KEEP_ALIVE_S = 300;

async function writeLock(token: string, note: string): Promise<void> {
  await saveSettings({ [CHAIN_SETTING]: JSON.stringify({ token, at: token ? new Date().toISOString() : "", note: `${new Date().toISOString()} · ${note}` }) });
}

/** Есть ли сейчас работа: собрать план, запустить план или идущая рассылка. Одно чтение. */
async function workExists(now: Date): Promise<{ plan: boolean; activate: boolean; sending: boolean; map: Record<string, string> }> {
  await prefetchTables([SHEET_TABS.SETTINGS, SHEET_TABS.BROADCASTS]);
  const [map, broadcasts] = await Promise.all([settingsMap(), listBroadcasts()]);
  const plan = parsePlanRecord(map[AUTO_PLAN_SETTING]);
  return {
    plan: planDue(now, plan, parseAutoConfig(map[AUTO_SETTING])),
    activate: activationDue(now, plan),
    sending: broadcasts.some((b) => b.status === BROADCAST_STATUSES.SENDING),
    map,
  };
}

export interface ChainResult {
  ok: boolean;
  skipped?: string;
  planned?: number;
  activated?: number;
  steps?: { broadcastId: string; line: string; step: SendStep }[];
  nextIn?: number;
}

/**
 * Один шаг цепочки. Берёт замок (один ведущий на весь сайт), при необходимости собирает и запускает план,
 * по каждому номеру отправляет следующее сообщение идущей рассылки и, если ждать недолго, сам себя будит.
 */
export async function runBroadcastChain(input: { token?: string; origin: string }): Promise<ChainResult> {
  const started = Date.now();
  const now = new Date();
  const t = almatyParts(now);
  if (t.hour < 9 || t.hour >= 19) return { ok: true, skipped: "ночь" };
  const work = await workExists(now);
  const lock = parseChainLock(work.map[CHAIN_SETTING]);
  const token = input.token || randomUUID();
  if (chainBusy(lock, token, now)) return { ok: true, skipped: "цепочка уже идёт" };
  if (!input.token && !work.plan && !work.activate && !work.sending) return { ok: true, skipped: "нет работы" };

  // Замок: записать себя, подождать, перечитать — остался свой токен, значит ведём мы.
  await writeLock(token, "ведёт");
  await sleep(1200);
  const again = parseChainLock((await settingsMap(true))[CHAIN_SETTING]);
  if (again.token !== token) return { ok: true, skipped: "замок у другого" };

  const result: ChainResult = { ok: true };
  try {
    if (work.plan) {
      const r = await planAutoBroadcasts({ now });
      result.planned = r.messages;
      // План — тяжёлая работа; отправка — следующим шагом.
      await writeLock(token, `план: ${r.note}`);
      await fire(input.origin, token);
      return { ...result, nextIn: 1 };
    }
    if (work.activate || activationDue(now, parsePlanRecord(work.map[AUTO_PLAN_SETTING]))) result.activated = await activateDuePlan(now);

    const sending = (await listBroadcasts(true)).filter((b) => b.status === BROADCAST_STATUSES.SENDING);
    if (!sending.length) {
      await writeLock("", "отправлять нечего");
      return { ...result, nextIn: 0 };
    }
    // По одной рассылке на номер — первая запущенная; номера — параллельно.
    const byLine = new Map<string, (typeof sending)[number]>();
    const order = (a: (typeof sending)[number], c: (typeof sending)[number]) =>
      (a.startedAt || a.createdAt).localeCompare(c.startedAt || c.createdAt) || a.createdAt.localeCompare(c.createdAt);
    for (const b of sending.sort(order)) {
      if (!byLine.has(b.line || "")) byLine.set(b.line || "", b);
    }
    const steps = await Promise.all(
      Array.from(byLine.values()).map(async (b) => {
        try {
          return { broadcastId: b.broadcastId, line: b.line || "", step: await sendNextBroadcastMessage(b.broadcastId) };
        } catch (err) {
          console.error("broadcast chain:", err instanceof Error ? err.message : err);
          return { broadcastId: b.broadcastId, line: b.line || "", step: { status: b.status, remaining: 0, waitSeconds: 60, note: "ошибка шага" } as SendStep };
        }
      })
    );
    result.steps = steps;
    // Закончилась одна рассылка на номере — следующая на том же номере идёт сразу.
    const wait = chainWait(steps.map((s) => (s.step.changed && s.step.status !== BROADCAST_STATUSES.PAUSED ? 1 : s.step.waitSeconds || 1)));
    const sentNote = steps.filter((s) => s.step.sentTo).map((s) => `${s.line || "рабочий"} → ${s.step.sentTo}`).join(", ");
    if (wait > KEEP_ALIVE_S) {
      await writeLock("", `${sentNote || "ждём"} · дальше через ${Math.round(wait / 60)} мин`);
      return { ...result, nextIn: wait };
    }
    await writeLock(token, sentNote || `ждём ${wait} с`);
    // Функция живёт минуту: ждём не дольше, чем до 50-й секунды, дальше — следующий шаг.
    const elapsed = (Date.now() - started) / 1000;
    const sleepS = Math.max(1, Math.min(wait, MAX_SLEEP_S - elapsed));
    await sleep(sleepS * 1000);
    await fire(input.origin, token);
    return { ...result, nextIn: sleepS };
  } catch (err) {
    console.error("broadcast chain:", err instanceof Error ? err.message : err);
    await writeLock("", `ошибка: ${err instanceof Error ? err.message : err}`).catch(() => undefined);
    return { ...result, ok: false };
  }
}

/** Разбудить следующий шаг: запрос обрываем сами — он живёт своей функцией. */
async function fire(origin: string, token: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/broadcast/auto?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами.
  }
}

/** Вебхуки и расписание будят цепочку (днём, не чаще раза в 2 минуты на экземпляр). */
export async function kickBroadcast(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  const t = almatyParts(new Date());
  if (t.hour < 9 || t.hour >= 19) return;
  const g = globalThis as unknown as { __broadcastKick?: number };
  const now = Date.now();
  if (g.__broadcastKick && now - g.__broadcastKick < 2 * 60000) return;
  g.__broadcastKick = now;
  try {
    await fetch(`${origin}/api/broadcast/auto?source=kick`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами.
  }
}
