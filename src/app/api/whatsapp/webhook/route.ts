import { NextResponse } from "next/server";
import { downloadMedia, webhookTokenOk } from "@/lib/greenApi";
import { openAiConfigured, transcribeAudio } from "@/lib/openai";
import { parseGreenWebhook } from "@/lib/whatsapp";
import { appendWaMessages } from "@/lib/repo/talks";
import { createLead, listLeads, updateLead } from "@/lib/repo/leads";
import { listClients } from "@/lib/repo/clients";
import { listUsers } from "@/lib/repo/users";
import { phoneKey } from "@/lib/leads";
import { autoLeadFromMessage, leadsLineOwner, namedFromWhatsApp } from "@/lib/waAutoLead";
import { localDayKey } from "@/lib/timezone";
import type { WaMessage } from "@/lib/types";
import { appendWaStatuses } from "@/lib/repo/broadcasts";
import { botIncomingOf, parseGreenStatus } from "@/lib/greenOut";
import { runBot } from "@/lib/botEngine";
import { draftFromIncoming } from "@/lib/waOrderRunner";
import { kickFollowup } from "@/lib/botFollowUpRun";
import { leadsLine as zemfiraLine, listWaLines } from "@/lib/repo/waLines";
import { genitiveName, isManagerLine, isWorkTime, type WaLine } from "@/lib/waLines";
import { kickAssistant, kickAssistantChat, kickLineWatch } from "@/lib/lineAssistant";
import { staffPhoneKeys } from "@/lib/botSalesAlert";
import { ourPhoneKeys } from "@/lib/lineNotify";
import { lineHookKeyOk } from "@/lib/secretBox";
import { settingsMap } from "@/lib/repo/broadcasts";
import { cancelFromWhatsApp, kickBroadcast } from "@/lib/autoBroadcastRunner";
import { isCancelText } from "@/lib/autoBroadcast";
import { greenConfig, sendText } from "@/lib/greenApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Уведомления Green API о сообщениях рабочего WhatsApp:
 * `https://www.crm-ecoculture.kz/api/whatsapp/webhook`. Адрес и токен
 * прописывает `scripts/whatsapp-setup.ts` (его запускает whatsapp-key.bat).
 *
 * Входа тут нет, поэтому доверяем только ТОКЕНУ (`Authorization: Bearer …`,
 * WHATSAPP_WEBHOOK_TOKEN); без него — 401 и ничего не пишется. Статус доставки
 * сообщения, отправленного через API (рассылка, бот), пишется в WaStatuses;
 * остальное, что не сообщение из личного чата (статусы переписки с телефона,
 * группы, реакции), — 200 без записи, иначе Green API повторял бы уведомление.
 *
 * После записи сообщения — бот (`runBot`): отвечает клиенту или замечает, что
 * ответил живой менеджер. И заказ из сообщения клиента — черновиком заявки
 * (`draftFromIncoming`, «Заявки → Заказы из WhatsApp»). Ни то ни другое вебхук не роняет.
 *
 * Таблицу вебхук НЕ читает: лимит Google общий на всю компанию (грабли 1.17), а
 * к лиду сообщение привязывается при чтении, по номеру. Голосовое расшифровывается
 * сразу: ссылка на файл у Green API живёт не вечно.
 */
export async function POST(request: Request) {
  // Номер менеджера можно подключить и адресом с ключом номера (`lineHookKey`) — без поля токена в кабинете.
  const q = new URL(request.url).searchParams;
  const lineKeyOk = isManagerLine(q.get("line")) && lineHookKeyOk(q.get("line") || "", q.get("key"));
  if (!lineKeyOk && !webhookTokenOk(request.headers.get("authorization"), process.env.WHATSAPP_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Номер Земфиры (`?line=leads`): переписка в CRM и статусы её рассылок — без бота и черновиков.
  const lineParam = new URL(request.url).searchParams.get("line") || "";
  // Автопилот рассылок шлёт с сайта; любое уведомление днём будит его цепочку (не чаще раза в 2 мин).
  await kickBroadcast(siteOrigin(request));
  if (lineParam === "leads") return leadsLine(body, request);
  // Номер менеджера (`?line=m-…`, 16.10.2026): переписка, авто-лид на него и ИИ-помощник.
  if (isManagerLine(lineParam)) return managerLine(body, lineParam, request);

  const status = parseGreenStatus(body);
  if (status) {
    try {
      await appendWaStatuses([status]);
      await kickFollowup(siteOrigin(request));
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("whatsapp status:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "temporary" }, { status: 500 });
    }
  }

  const message = parseGreenWebhook(body);
  if (!message) return NextResponse.json({ ok: true, ignored: true });

  if (message.type === "voice" && message.mediaUrl && openAiConfigured()) {
    try {
      const file = await downloadMedia(message.mediaUrl);
      if (file) {
        const text = await transcribeAudio(file.data, file.mime);
        if (text) message.text = [message.text, text].filter(Boolean).join(" · ");
      }
    } catch (err) {
      // Не расшифровалось — сообщение всё равно сохраняем: разбор попробует ещё раз.
      console.error("whatsapp voice:", err instanceof Error ? err.message : err);
    }
  }

  try {
    await appendWaMessages([message]);
  } catch (err) {
    // 500 — Green API повторит позже; это правильно, если не ответила таблица.
    console.error("whatsapp webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }

  // Бот отвечает клиенту и сам оформляет заказ (`botOrderRunner.ts`). Если бот
  // промолчал (выключен, в чате пишет менеджер), заказ из сообщения становится
  // черновиком заявки для менеджера (`waOrder.ts`) — иначе вышло бы две заявки.
  // Оба ничего не бросают.
  // Сотрудник ответил на утренний план авторассылок «ОТМЕНА» — останавливаем сегодняшние (17.10.2026).
  if (message.direction === "in" && isCancelText(message.text)) {
    try {
      if (staffPhoneKeys(await settingsMap(true)).has(phoneKey(message.phone))) {
        const reply = await cancelFromWhatsApp(message.phone);
        const cfg = greenConfig();
        if (cfg) await sendText(cfg, message.phone, reply).catch(() => undefined);
        return NextResponse.json({ ok: true, cancelled: true });
      }
    } catch (err) {
      console.error("auto broadcast cancel:", err instanceof Error ? err.message : err);
    }
  }

  const incoming = botIncomingOf(body, message);
  const botAnswered = incoming ? await runBot([incoming]) : false;
  if (!botAnswered) await draftFromIncoming(message);
  // Заодно — дожим молчащих и напоминания об оплате (не чаще раза в 25 мин, `botFollowUpRun.ts`).
  await kickFollowup(siteOrigin(request));
  await kickAssistant(siteOrigin(request));
  return NextResponse.json({ ok: true });
}

/**
 * Сообщение с номера Земфиры: записать (голосовое — с расшифровкой), авто-лид, и — если помощник на её номере включён
 * (настройка `LeadsAssistant`, 20.10.2026) — разбудить его: вне рабочего времени ответ этому чату сразу после серии
 * сообщений, днём — общий проход (ответит, если Земфира молчит 20 минут). Бота и черновиков заявок здесь нет.
 */
async function leadsLine(body: unknown, request: Request) {
  // Статусы сообщений рассылки с номера Земфиры (15.10.2026) — для «прочитали». С её телефона — нет (`sendByApi`).
  const status = parseGreenStatus(body);
  if (status) {
    try {
      await appendWaStatuses([status]);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("whatsapp leads status:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "temporary" }, { status: 500 });
    }
  }
  const message = parseGreenWebhook(body);
  if (!message) return NextResponse.json({ ok: true, ignored: true });
  message.line = "leads";
  if (message.type === "voice" && message.mediaUrl && openAiConfigured()) {
    try {
      const file = await downloadMedia(message.mediaUrl);
      if (file) {
        const text = await transcribeAudio(file.data, file.mime);
        if (text) message.text = [message.text, text].filter(Boolean).join(" · ");
      }
    } catch (err) {
      console.error("whatsapp leads voice:", err instanceof Error ? err.message : err);
    }
  }
  try {
    await appendWaMessages([message]);
  } catch (err) {
    console.error("whatsapp leads webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
  // Сообщение уже записано — сбой здесь не повод Green API слать его заново.
  try {
    await autoLead(message);
  } catch (err) {
    console.error("whatsapp leads auto-lead:", err instanceof Error ? err.message : err);
  }
  try {
    const zemfira = message.direction === "in" ? await zemfiraLine() : null;
    if (zemfira?.assistant === "on" && !isWorkTime(new Date())) await kickAssistantChat(siteOrigin(request), zemfira.code, message.phone);
    else await kickAssistant(siteOrigin(request));
  } catch (err) {
    console.error("whatsapp leads assistant:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}

/**
 * Сообщение с номера менеджера (16.10.2026): записать (голосовое — с расшифровкой), статусы его рассылок,
 * авто-лид на менеджера (только входящее с незнакомого номера), а вне рабочего времени — ответ ИИ-помощника
 * сразу после серии сообщений. Днём помощника будит проход (`kickAssistant`): он ответит, если менеджер молчит 20 минут.
 * Номер в режиме «продаёт сам» — его сторож (`kickLineWatch`): 5 минут молчания менеджера.
 */
async function managerLine(body: unknown, code: string, request: Request) {
  const line = (await listWaLines()).find((l) => l.code === code);
  // Номер удалили или выключили — 200, чтобы Green API не повторял.
  if (!line || !line.active) return NextResponse.json({ ok: true, ignored: "line off" });
  const status = parseGreenStatus(body);
  if (status) {
    try {
      await appendWaStatuses([status]);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("whatsapp line status:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "temporary" }, { status: 500 });
    }
  }
  const message = parseGreenWebhook(body);
  if (!message) return NextResponse.json({ ok: true, ignored: true });
  message.line = code;
  if (message.type === "voice" && message.mediaUrl && openAiConfigured()) {
    try {
      const file = await downloadMedia(message.mediaUrl);
      if (file) {
        const text = await transcribeAudio(file.data, file.mime);
        if (text) message.text = [message.text, text].filter(Boolean).join(" · ");
      }
    } catch (err) {
      console.error("whatsapp line voice:", err instanceof Error ? err.message : err);
    }
  }
  try {
    await appendWaMessages([message]);
  } catch (err) {
    console.error("whatsapp line webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
  try {
    if (message.direction === "in") await autoLead(message, line);
  } catch (err) {
    console.error("whatsapp line auto-lead:", err instanceof Error ? err.message : err);
  }
  if (message.direction === "in" && line.assistant === "sell") {
    // «Продаёт сам» (19.10.2026): сторож номера ответит, когда менеджер помолчит 5 минут (вечером — после серии).
    await kickLineWatch(siteOrigin(request), code);
  } else if (message.direction === "in" && line.assistant === "on" && !isWorkTime(new Date())) {
    // Вне рабочего времени — отдельной функцией (Green API не ждёт вебхук долго): она дождётся конца серии
    // сообщений клиента и ответит этому чату.
    await kickAssistantChat(siteOrigin(request), code, message.phone);
  } else {
    await kickAssistant(siteOrigin(request));
  }
  return NextResponse.json({ ok: true });
}

/**
 * Разговор с незнакомым номером на линии Земфиры — сразу её лид «с рекламы» (`autoLeadFromMessage`);
 * лид с именем-заглушкой получает имя из WhatsApp, когда клиент напишет сам (`namedFromWhatsApp`).
 */
async function autoLead(message: WaMessage, line?: WaLine) {
  const key = phoneKey(message.phone);
  if (!key) return;
  // Лиды — свежие: клиент пишет тремя сообщениями подряд, лид должен завестись один раз.
  const leads = await listLeads({ fresh: true });
  const own = leads.find((l) => phoneKey(l.phone) === key);
  if (own) {
    const named = namedFromWhatsApp(own, message);
    if (named) await updateLead(own.leadId, named);
    return;
  }
  const [clients, users] = await Promise.all([listClients(), listUsers()]);
  const known = new Set<string>();
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) known.add(phoneKey(p));
  const day = localDayKey();
  if (line) {
    // Сотрудники и наши же номера лидами не становятся.
    for (const k of Array.from(await ourPhoneKeys(await settingsMap()))) known.add(k);
    const name = users.find((u) => u.email.toLowerCase() === line.managerEmail)?.name || line.label;
    const lead = autoLeadFromMessage(message, known, line.managerEmail, day, { whose: genitiveName(name), origin: "", incomingOnly: true });
    if (lead) await createLead(lead, day);
    return;
  }
  const lead = autoLeadFromMessage(message, known, leadsLineOwner(users), day);
  if (lead) await createLead(lead, day);
}

/** Адрес сайта для своего же вызова: основной (с www), иначе — тот, куда пришёл вебхук. */
function siteOrigin(request: Request): string {
  const configured = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
