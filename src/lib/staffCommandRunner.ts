import { chatJson, openAiConfigured } from "./openai";
import { greenConfig, type GreenConfig } from "./greenApi";
import { phoneKey } from "./leads";
import { messageText } from "./whatsapp";
import { isAckOnly, waPhone } from "./broadcast";
import { ourPhoneKeys } from "./lineNotify";
import { settingsMap } from "./repo/broadcasts";
import { saveSettings } from "./repo/settings";
import { listUsers } from "./repo/users";
import { listClients } from "./repo/clients";
import { listLeads } from "./repo/leads";
import { listOrdersWithItems } from "./repo/orders";
import { botChatWrite, emptyBotChat, listBotChats } from "./repo/broadcasts";
import { listWaMessages } from "./repo/talks";
import { listWaLines, lineConfig } from "./repo/waLines";
import { commitAtomic } from "./sheets";
import { BOT_MODES } from "./broadcast";
import { FLOWER_TYPE_LABELS, formatGrade, ORDER_STATUSES } from "./constants";
import { genitiveName, LEADS_LINE } from "./waLines";
import { orderCode } from "./paymentStage";
import { sendOnLine } from "./lineAssistant";
import { loadPhotoContext, photoPrices } from "./botPhotoSend";
import { isInfoPhoto, photoLabel, photoMessage } from "./botPhotos";
import { pricesForBot } from "./botKnowledge";
import { isNoText, isYesText, parseStaffBroadcastPlan, STAFF_BROADCAST_PREFIX, type StaffBroadcastPlan } from "./staffBroadcast";
import { planStaffBroadcast, runStaffBroadcastPlan } from "./staffBroadcastRunner";
import {
  dropRecipients,
  dueReminders,
  exclusionNames,
  exclusionReplyText,
  isSelfTarget,
  latestClientOrder,
  matchTargets,
  muteDoneText,
  muteNote,
  wantsForSelf,
  parseReminders,
  parseStaffCommand,
  pickedNumber,
  pickStaffPhotos,
  quoteLines,
  reminderConfirmText,
  reminderText,
  reminderTime,
  STAFF_ASK_PREFIX,
  STAFF_ASK_TTL_MS,
  STAFF_COMMAND_SCHEMA,
  STAFF_OTHER_TEXT,
  STAFF_REMINDERS_SETTING,
  staffAskText,
  staffCommandPrompt,
  staffDoneText,
  staffNotFoundText,
  staffOrderText,
  staffQuoteText,
  type StaffCommand,
  type StaffReminder,
  type StaffTarget,
} from "./staffCommand";
import type { AppUser, WaMessage } from "./types";

// Поручения сотрудников основному номеру — правила в `staffCommand.ts`.

interface Pending {
  at: string;
  command: StaffCommand;
  targets: StaffTarget[];
}

function parsePending(raw: string | undefined): Pending | null {
  try {
    const p = JSON.parse(raw || "") as Pending;
    if (!p?.at || !p.command || Date.now() - Date.parse(p.at) > STAFF_ASK_TTL_MS) return null;
    return { ...p, targets: Array.isArray(p.targets) ? p.targets : [] };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «ГГГГ-ММ-ДДTЧЧ:ММ» по Алматы — ключ времени для напоминаний (сервер живёт по Алматы, но считаем явно). */
export function almatyNowKey(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

/** Ответ сотруднику с основного номера — и в переписку CRM. */
async function replyStaff(cfg: GreenConfig, phone: string, text: string): Promise<void> {
  await sendOnLine("", cfg, phone, text, "crm", "bot").catch((err) => console.error("staff reply:", err instanceof Error ? err.message : err));
}

/** Кто из сотрудников написал: по номеру в карточке, иначе по номеру его линии WhatsApp. */
async function staffUserOf(key: string): Promise<AppUser | null> {
  const users = await listUsers();
  const byPhone = users.find((u) => u.phone && phoneKey(u.phone) === key);
  if (byPhone) return byPhone;
  const line = (await listWaLines()).find((l) => l.phone && phoneKey(l.phone) === key);
  return line ? users.find((u) => u.email.toLowerCase() === line.managerEmail.toLowerCase()) ?? null : null;
}

/** Все, кому можно отправить: клиенты, лиды и имена в WhatsApp (как записал менеджер в телефоне). */
async function targetCandidates(messages: WaMessage[]): Promise<{ text: string; target: StaffTarget }[]> {
  const [clients, leads] = await Promise.all([listClients(), listLeads()]);
  const lastAt = new Map<string, string>();
  for (const m of messages) {
    const k = phoneKey(m.phone);
    if (k && (lastAt.get(k) || "") < m.at) lastAt.set(k, m.at);
  }
  const at = (p: string) => lastAt.get(phoneKey(p)) || "";
  const out: { text: string; target: StaffTarget }[] = [];
  for (const c of clients) {
    if (!c.active || (c.retail || "").trim()) continue;
    for (const p of [c.phone, c.messenger]) {
      if (!waPhone(p)) continue;
      out.push({ text: `${c.name} ${c.contactPerson} ${c.city} ${c.address}`, target: { phone: waPhone(p), name: c.name, kind: "клиент", managerEmail: c.managerEmail, lastAt: at(p), clientId: c.clientId } });
    }
  }
  for (const l of leads) {
    if (!waPhone(l.phone)) continue;
    out.push({ text: `${l.name} ${l.contactPerson} ${l.city}`, target: { phone: waPhone(l.phone), name: l.name, kind: "лид", managerEmail: l.managerEmail, lastAt: at(l.phone) } });
  }
  const seen = new Set<string>();
  for (const m of messages) {
    const name = (m.senderName || "").trim();
    const k = `${phoneKey(m.phone)}|${name}`;
    if (!name || m.direction !== "in" || seen.has(k) || !waPhone(m.phone)) continue;
    seen.add(k);
    out.push({ text: name, target: { phone: waPhone(m.phone), name, kind: "WhatsApp", managerEmail: "", lastAt: at(m.phone) } });
  }
  return out;
}

/** С какого номера писать клиенту: где он переписывался последним; нет — номер сотрудника; нет — основной. */
async function sendingLine(target: StaffTarget, messages: WaMessage[], staff: AppUser | null): Promise<{ code: string; cfg: GreenConfig; via: string } | null> {
  const lines = await listWaLines();
  const users = await listUsers();
  const via = (code: string) => {
    if (!code) return "основного номера";
    if (code === LEADS_LINE) return "номера Земфиры";
    const l = lines.find((x) => x.code === code);
    const name = users.find((u) => u.email.toLowerCase() === (l?.managerEmail || "").toLowerCase())?.name?.split(/\s+/)[0] || l?.label || code;
    return `номера ${genitiveName(name)}`;
  };
  const key = phoneKey(target.phone);
  const tried = new Set<string>();
  const order = messages
    .filter((m) => phoneKey(m.phone) === key)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .map((m) => m.line || "");
  const own = staff ? lines.find((l) => l.active && l.managerEmail.toLowerCase() === staff.email.toLowerCase())?.code : undefined;
  for (const code of [...order, ...(own ? [own] : []), ""]) {
    if (tried.has(code)) continue;
    tried.add(code);
    const cfg = await lineConfig(code);
    if (cfg) return { code, cfg, via: via(code) };
  }
  return null;
}

/** Адресат «сам сотрудник»: фото уходят ему же, с основного номера, на который он написал. */
function selfTarget(staffPhone: string): StaffTarget {
  return { phone: waPhone(staffPhone) || staffPhone.replace(/\D/g, ""), name: "вам", kind: "сотрудник", managerEmail: "", lastAt: "" };
}

async function execute(command0: StaffCommand, target: StaffTarget, staff: AppUser | null, staffPhone: string, main: GreenConfig, messages: WaMessage[]): Promise<void> {
  let command = command0;
  const self = phoneKey(target.phone) === phoneKey(staffPhone);
  if (command.intent === "mute" || command.intent === "unmute") return setMuted(target, command.intent === "mute", staff, staffPhone, main);
  const line = self ? { code: "", cfg: main, via: "основного номера" } : await sendingLine(target, messages, staff);
  if (!line) return replyStaff(main, staffPhone, "Не получилось: ни один номер WhatsApp сейчас не подключён.");
  if (command.intent === "send_order") {
    // Заказ клиента: последняя живая заявка — её состав, сумма, доставка и оплата; текст собирает код.
    const orders = await listOrdersWithItems();
    const order = latestClientOrder(orders, target);
    if (!order) return replyStaff(main, staffPhone, `У ${target.name} (…${target.phone.slice(-4)}) нет заявок за последние 60 дней — отправлять нечего.`);
    const itemName = (i: { flowerType: string; variety: string; grade: string }) => `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType}${i.variety ? ` ${i.variety}` : ""}${i.grade ? `, ${formatGrade(i.grade)}` : ""}`;
    const text = staffOrderText({ code: orderCode(order.orderId), order, itemName, shipped: order.status === ORDER_STATUSES.SHIPPED });
    command = { ...command, items: [], text };
    if (self) {
      await sendOnLine("", main, target.phone, text, "crm", staff?.email || "staff", `поручение ${staff?.name || "сотрудника"}`);
      return;
    }
  }
  const ctx = await loadPhotoContext();
  const { picked, missing } = pickStaffPhotos(ctx.photos, command.items);
  const byEmail = staff?.email || "staff";
  const note = `поручение ${staff?.name || "сотрудника"}`;
  const sent: string[] = [];
  try {
    for (let i = 0; i < picked.length; i++) {
      const p = picked[i];
      const last = i === picked.length - 1 && !command.text && !self;
      // У инфографики свои цены не нужны — на ней категории.
      const prices = isInfoPhoto(p) ? [] : photoPrices(p, ctx);
      const caption = photoMessage({ caption: p.caption, prices, question: last ? "Какие интересуют? Подскажу по наличию и соберу заказ." : "" });
      await sendOnLine(line.code, line.cfg, target.phone, caption, "crm", byEmail, note, p);
      sent.push(photoLabel(p) + (isInfoPhoto(p) ? " (инфографика)" : ""));
      await sleep(1500);
    }
    if (command.text) await sendOnLine(line.code, line.cfg, target.phone, command.text, "crm", byEmail, note);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return replyStaff(main, staffPhone, `Отправил ${sent.length} из ${picked.length}, дальше ошибка: ${why}. Попробуйте ещё раз позже.`);
  }
  if (!sent.length && !command.text) {
    return replyStaff(main, staffPhone, `Фото ${missing.join(", ") || "по этому поручению"} в CRM нет — ничего не отправил. Пришлите фото владельцу, загружу.`);
  }
  // Себе — отчёт нужен только о том, чего нет: фото человек и так видит.
  if (self) {
    if (missing.length) await replyStaff(main, staffPhone, `Фото нет в CRM: ${missing.join(", ")} — загрузите в «Рассылки → Фото и каталог».`);
    return;
  }
  if (command.intent === "send_order") return replyStaff(main, staffPhone, `Отправил ${target.name} (…${target.phone.slice(-4)}) её заказ с ${line.via}:\n\n${command.text}`);
  await replyStaff(main, staffPhone, staffDoneText({ name: target.name, phone: target.phone, via: line.via, sent, missing, text: !!command.text }));
}

/**
 * «Не пиши клиенту X» / «можно снова писать X»: память бота основного номера — режим optout (как «СТОП» от самого
 * клиента): её чтут бот, дожим, рассылки и автопилот; помощник номеров менеджеров и их дожим — через `optedOutKeys()`.
 */
async function setMuted(target: StaffTarget, on: boolean, staff: AppUser | null, staffPhone: string, main: GreenConfig): Promise<void> {
  const chats = await listBotChats(true);
  const key = phoneKey(target.phone);
  const existing = chats.find((c) => phoneKey(c.phone) === key) ?? null;
  const chat = existing ? { ...existing } : emptyBotChat(target.phone);
  if (on) {
    chat.mode = BOT_MODES.OPT_OUT;
    chat.handoffReason = muteNote(staff?.name?.split(/\s+/)[0] || "");
  } else {
    if (chat.mode === BOT_MODES.OPT_OUT) chat.mode = BOT_MODES.BOT;
    chat.handoffReason = "";
  }
  if (!existing) chat.name = target.name;
  await commitAtomic([botChatWrite(chat, existing?.rowNumber ?? null)]);
  await replyStaff(main, staffPhone, muteDoneText(target.name, target.phone, on));
}

/** Поручение, которому нужен клиент: отправить фото/сообщение/заказ, не писать, снова писать. */
function needsTarget(intent: StaffCommand["intent"]): boolean {
  return intent === "send" || intent === "send_order" || intent === "mute" || intent === "unmute";
}

/** Напоминания, чей час настал: сотруднику с основного номера; отправленные — из списка долой. */
export async function sendDueStaffReminders(): Promise<{ sent: number; left: number }> {
  const main = greenConfig();
  const nowKey = almatyNowKey();
  const map = await settingsMap(true);
  const list = parseReminders(map[STAFF_REMINDERS_SETTING]);
  const due = dueReminders(list, nowKey);
  if (!main || !due.length) return { sent: 0, left: list.length };
  const sentIds = new Set<string>();
  for (const r of due) {
    try {
      await sendOnLine("", main, r.phone, reminderText(r), "crm", "bot");
      sentIds.add(r.id);
    } catch (err) {
      console.error("staff reminder:", err instanceof Error ? err.message : err);
    }
  }
  const left = list.filter((r) => !sentIds.has(r.id));
  if (sentIds.size) await saveSettings({ [STAFF_REMINDERS_SETTING]: JSON.stringify(left) });
  return { sent: sentIds.size, left: left.length };
}

/** Ответ на план рассылки списком имён: убрать названных; «да, кроме …» — сразу запустить остаток. */
async function applyPlanExclusions(plan: StaffBroadcastPlan, text: string, ex: { names: string[]; more: number }, staff: AppUser | null, broadcastKey: string): Promise<string> {
  const { names } = ex;
  const { kept, removed } = dropRecipients(plan.recipients, names, ex.more);
  const notFound = names.filter((n) => !dropRecipients(plan.recipients, [n]).removed.length);
  const run = /^(да|ок|окей)\b/i.test(text.trim());
  const next = { ...plan, recipients: kept };
  if (!kept.length || (run && !removed.length && notFound.length)) {
    await saveSettings({ [broadcastKey]: kept.length ? JSON.stringify(next) : "" });
    return exclusionReplyText({ removed: removed.map((r) => r.name || `…${r.phone.slice(-4)}`), notFound, left: kept.length, run: false });
  }
  if (run) {
    await saveSettings({ [broadcastKey]: "" });
    const head = exclusionReplyText({ removed: removed.map((r) => r.name || `…${r.phone.slice(-4)}`), notFound, left: kept.length, run: true });
    return `${head ? `${head}\n` : ""}${await runStaffBroadcastPlan(next, staff)}`;
  }
  await saveSettings({ [broadcastKey]: JSON.stringify(next) });
  return exclusionReplyText({ removed: removed.map((r) => r.name || `…${r.phone.slice(-4)}`), notFound, left: kept.length, run: false });
}

/** Разбор поручения моделью: список фото и прайс на сегодня — чтобы сорта и категории были как в CRM. */
async function understand(text: string, ctx: Awaited<ReturnType<typeof loadPhotoContext>>): Promise<StaffCommand> {
  const photos = ctx.photos.filter((p) => p.active && p.fileId);
  const labels = Array.from(new Set(photos.map((p) => photoLabel(p) + (isInfoPhoto(p) ? " (инфографика категорий)" : ""))));
  const priceList = pricesForBot(Array.from(ctx.prices.values()));
  const { data } = await chatJson(staffCommandPrompt(labels, priceList, almatyNowKey().replace("T", " ")), text, "staff_command", STAFF_COMMAND_SCHEMA, { fast: true });
  return parseStaffCommand(data);
}

/**
 * Сообщение на основной номер с номера сотрудника: поручение — выполнить, ответ цифрой на «кому из них?» — выполнить
 * отложенное, остальное — промолчать. true — сообщение сотрудника (бот его дальше не трогает).
 */
export async function handleStaffMessage(message: WaMessage): Promise<boolean> {
  if (message.direction !== "in" || (message.line || "") !== "") return false;
  const key = phoneKey(message.phone);
  if (!key) return false;
  const map = await settingsMap();
  if (!(await ourPhoneKeys(map)).has(key)) return false;
  const main = greenConfig();
  const text = messageText(message).trim();
  if (!main || !text) return true;
  try {
    const settingKey = `${STAFF_ASK_PREFIX}${key}`;
    const fresh = await settingsMap(true);
    const pending = parsePending(fresh[settingKey]);
    const staff = await staffUserOf(key);

    // Ответ на план рассылки: «ДА» — запустить, «НЕТ» — забыть (27.10.2026, `staffBroadcast.ts`).
    const broadcastKey = `${STAFF_BROADCAST_PREFIX}${key}`;
    const broadcastPlan = parseStaffBroadcastPlan(fresh[broadcastKey]);
    if (broadcastPlan && (isYesText(text) || isNoText(text))) {
      await saveSettings({ [broadcastKey]: "" });
      await replyStaff(main, message.phone, isNoText(text) ? "Хорошо, рассылку не запускаю." : await runStaffBroadcastPlan(broadcastPlan, staff));
      return true;
    }
    // «Нет, Наталья, Жамал, … — этим клиентам нет» / «да, кроме Фарида»: правка списка плана (28.10.2026).
    if (broadcastPlan) {
      const ex = exclusionNames(text);
      if (ex.names.length) {
        await replyStaff(main, message.phone, await applyPlanExclusions(broadcastPlan, text, ex, staff, broadcastKey));
        return true;
      }
    }
    const messages = await listWaMessages({ lines: "all" });

    // Ответ на «кому из них?» — цифрой или номером телефона.
    if (pending) {
      const n = pickedNumber(text);
      const phone = waPhone(text.replace(/[^\d+]/g, ""));
      const target =
        n && pending.targets[n - 1]
          ? pending.targets[n - 1]
          : phone
            ? { phone, name: `+${phone}`, kind: "номер", managerEmail: "", lastAt: "" }
            : isSelfTarget(text)
              ? selfTarget(message.phone)
              : null;
      if (target) {
        await saveSettings({ [settingKey]: "" });
        await execute(pending.command, target, staff, message.phone, main, messages);
        return true;
      }
    }
    if (isAckOnly(text) || !openAiConfigured()) return true;

    const ctx = await loadPhotoContext();
    let command = await understand(text, ctx);
    if (command.intent === "none") return true;
    // Рассылка своим клиентам: сначала план и «ДА».
    if (command.intent === "broadcast") {
      const { reply, plan } = await planStaffBroadcast(command, staff, ctx);
      if (plan) await saveSettings({ [broadcastKey]: JSON.stringify(plan) });
      await replyStaff(main, message.phone, reply);
      return true;
    }
    // Напомнить сотруднику позже: в список напоминаний, шлёт час-в-час проход и утренняя сводка.
    if (command.intent === "remind") {
      if (!command.remindText) {
        await replyStaff(main, message.phone, "О чём напомнить? Напишите, например: «Напомни мне утром внести заявку Баглана».");
        return true;
      }
      const nowKey = almatyNowKey();
      const r: StaffReminder = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        phone: waPhone(message.phone) || message.phone.replace(/\D/g, ""),
        email: staff?.email || "",
        name: staff?.name || "",
        at: reminderTime(command.remindAt, nowKey),
        text: command.remindText,
        createdAt: new Date().toISOString(),
      };
      const list = parseReminders((await settingsMap(true))[STAFF_REMINDERS_SETTING]);
      await saveSettings({ [STAFF_REMINDERS_SETTING]: JSON.stringify([...list, r]) });
      await replyStaff(main, message.phone, reminderConfirmText(r, nowKey));
      return true;
    }
    // Посчитать стоимость: расчёт — сотруднику; назван клиент — тот же расчёт (без служебного) уходит клиенту.
    if (command.intent === "quote") {
      if (!command.items.length) {
        await replyStaff(main, message.phone, "Не понял список для расчёта. Напишите позициями: «Altaj 3 кат 200 шт, роза кустовая 60 см 40 шт, эустома белая 15 шт».");
        return true;
      }
      const lines = quoteLines(command.items, ctx.prices, ctx.stock);
      await replyStaff(main, message.phone, staffQuoteText(lines));
      if (!command.phone && (!command.client || isSelfTarget(command.client))) return true;
      if (!lines.some((l) => l.quantity && l.price)) return true;
      command = { ...command, intent: "send", items: [], text: staffQuoteText(lines, true) };
    }
    if (command.intent === "other" || (command.intent === "send" && !command.items.length && !command.text) || (needsTarget(command.intent) && command.intent !== "send" && !command.client && !command.phone)) {
      await replyStaff(main, message.phone, command.intent === "other" || command.intent === "send" ? STAFF_OTHER_TEXT : "Кому? Назовите клиента — имя, точку или номер.");
      return true;
    }
    const direct = waPhone(command.phone);
    let targets: StaffTarget[] = direct ? [{ phone: direct, name: command.client || `+${direct}`, kind: "номер", managerEmail: "", lastAt: "" }] : [];
    // Адресат не назван или «мне» — фото самому сотруднику, а не «не нашёл клиента «без имени»».
    if (!targets.length && command.intent === "send" && command.items.length && wantsForSelf(command, text)) {
      await execute(command, selfTarget(message.phone), staff, message.phone, main, messages);
      return true;
    }
    if (!targets.length && command.client) targets = matchTargets(command.client, await targetCandidates(messages), staff?.email);
    if (targets.length === 1) {
      await execute(command, targets[0], staff, message.phone, main, messages);
      return true;
    }
    const list = targets.slice(0, 6);
    await saveSettings({ [settingKey]: JSON.stringify({ at: new Date().toISOString(), command, targets: list } satisfies Pending) });
    await replyStaff(main, message.phone, list.length ? staffAskText(command.client, list) : staffNotFoundText(command.client || "без имени"));
  } catch (err) {
    console.error("staff command:", err instanceof Error ? err.message : err);
    await replyStaff(main, message.phone, "Не получилось выполнить поручение — сбой на сервере. Попробуйте ещё раз через минуту.");
  }
  return true;
}

/** Что бот сделал бы с поручением — без отправки (`scripts/staff-command-try.ts`). */
export async function dryRunStaffCommand(text: string, staffPhone: string): Promise<string[]> {
  const out: string[] = [];
  const key = phoneKey(staffPhone);
  const staff = await staffUserOf(key);
  out.push(`Сотрудник: ${staff ? `${staff.name} (${staff.email})` : "по номеру не узнан — номер сводки/продаж"}; наш номер: ${(await ourPhoneKeys(await settingsMap())).has(key) ? "да" : "НЕТ — поручение не примется"}`);
  const ctx = await loadPhotoContext();
  let command = await understand(text, ctx);
  out.push(`Разбор: ${JSON.stringify(command)}`);
  if (command.intent === "broadcast") {
    const { reply, plan } = await planStaffBroadcast(command, staff, ctx);
    out.push("Сотруднику:", reply);
    if (plan) out.push(`Номер: «${plan.line || "основной"}», фото: ${plan.fileId ? "из ротации" : "нет"}, получатели: ${plan.recipients.map((r) => `${r.name || "—"} …${r.phone.slice(-4)} (${r.kind})`).join("; ")}`);
    return out;
  }
  if (command.intent === "quote") {
    const lines = quoteLines(command.items, ctx.prices, ctx.stock);
    out.push("Сотруднику:", staffQuoteText(lines));
    if (!command.phone && (!command.client || isSelfTarget(command.client))) return out;
    command = { ...command, intent: "send", items: [], text: staffQuoteText(lines, true) };
    out.push("Клиенту:", command.text);
  }
  if (command.intent === "remind") {
    const nowKey = almatyNowKey();
    out.push(`Напоминание: «${command.remindText}» — ${reminderTime(command.remindAt, nowKey)} (модель: «${command.remindAt || "—"}», сейчас ${nowKey})`);
    return out;
  }
  if (!needsTarget(command.intent)) return out;
  const picks = pickStaffPhotos(ctx.photos, command.items);
  out.push(`Фото (${picks.picked.length}): ${picks.picked.map((p) => photoLabel(p) + (isInfoPhoto(p) ? " (инфографика)" : "")).join(", ")}`);
  if (picks.missing.length) out.push(`Нет в CRM: ${picks.missing.join(", ")}`);
  const messages = await listWaMessages({ lines: "all" });
  const direct = waPhone(command.phone);
  if (!direct && command.intent === "send" && wantsForSelf(command, text)) {
    out.push("Кому: самому сотруднику, с основного номера");
    return out;
  }
  const targets = direct ? [{ phone: direct, name: command.client, kind: "номер", managerEmail: "", lastAt: "" }] : matchTargets(command.client, await targetCandidates(messages), staff?.email);
  out.push(`Кому: ${targets.length ? targets.map((t) => `${t.name} …${t.phone.slice(-4)} (${t.kind})`).join("; ") : "не нашёл"}`);
  if (targets.length !== 1) return out;
  if (command.intent === "mute" || command.intent === "unmute") {
    out.push(command.intent === "mute" ? "Запрет писать: память бота → optout" : "Снять запрет: память бота → bot");
    return out;
  }
  if (command.intent === "send_order") {
    const order = latestClientOrder(await listOrdersWithItems(), targets[0]);
    out.push(order ? `Заявка: №${orderCode(order.orderId)} от ${order.createdAt.slice(0, 10)}, ${order.items.length} поз., ${order.totalAmount} ₸` : "Заявок за 60 дней нет");
  }
  const line = await sendingLine(targets[0], messages, staff);
  out.push(`С номера: ${line ? line.via : "нет подключённого"}`);
  return out;
}
