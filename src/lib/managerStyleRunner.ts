/**
 * Почерк менеджеров: пересчёт профилей по переписке и текст постояннику «его словами» (`managerStyle.ts`).
 *
 * `refreshManagerStyles()` — раз в неделю из утренней сводки (и `scripts/manager-style.ts`): по каждому подключённому
 * номеру менеджера берёт его собственные сообщения за 60 дней и пишет профиль в настройку `ManagerStyle:<код>`.
 * `styledText()` — просит модель написать сообщение в манере менеджера, проверяет цифры (`styledTextOk`) и при любом
 * сомнении отдаёт шаблон кода. Модель думает 5–15 с, поэтому `styledTexts()` идёт пачками и укладывается в бюджет
 * времени: не успели — остальным шаблон.
 */
import { prefetchTables, SHEET_TABS } from "./sheets";
import { listWaMessages } from "./repo/talks";
import { listWaLines, listAssistantLog } from "./repo/waLines";
import { listRecipients, settingsMap } from "./repo/broadcasts";
import { saveSettings } from "./repo/settings";
import { ourPhoneKeys } from "./lineNotify";
import { phoneKey } from "./leads";
import { chatJson, openAiConfigured } from "./openai";
import { plainTyping } from "./humanStyle";
import {
  STYLE_SETTING_PREFIX,
  STYLE_WINDOW_DAYS,
  allowedNumbers,
  buildStyleProfile,
  habitTaskLines,
  isOwnManagerMessage,
  parseStyleProfile,
  styleIsStale,
  stylePromptBlock,
  styleUsable,
  styledTextOk,
  type StyleProfile,
} from "./managerStyle";

export async function refreshManagerStyles(opts: { force?: boolean } = {}): Promise<{ code: string; messages: number; refreshed: boolean }[]> {
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.USERS, SHEET_TABS.SETTINGS]).catch(() => undefined);
  const [messages, lines, log, recipients, map] = await Promise.all([listWaMessages({ lines: "all" }), listWaLines(), listAssistantLog(), listRecipients(), settingsMap()]);
  const staffKeys = await ourPhoneKeys(map);
  const autoIds = new Set(log.filter((r) => r.kind !== "note").map((r) => r.messageId));
  const broadcastIds = new Set(recipients.map((r) => r.messageId).filter(Boolean));
  const since = new Date(Date.now() - STYLE_WINDOW_DAYS * 86400000).toISOString();
  const out: { code: string; messages: number; refreshed: boolean }[] = [];
  const writes: Record<string, string> = {};
  for (const line of lines.filter((l) => l.active && l.managerEmail)) {
    const current = parseStyleProfile(map[`${STYLE_SETTING_PREFIX}${line.code}`]);
    if (!opts.force && !styleIsStale(current)) {
      out.push({ code: line.code, messages: current?.messages ?? 0, refreshed: false });
      continue;
    }
    const own = messages.filter((m) => m.line === line.code && m.at >= since && isOwnManagerMessage(m, { autoIds, broadcastIds, staffKeys, keyOf: phoneKey }));
    const profile = buildStyleProfile(own.map((m) => m.text));
    writes[`${STYLE_SETTING_PREFIX}${line.code}`] = JSON.stringify(profile);
    out.push({ code: line.code, messages: profile.messages, refreshed: true });
  }
  if (Object.keys(writes).length) await saveSettings(writes);
  return out;
}

/** Профили по кодам линий из карты настроек. */
export function stylesFrom(map: Record<string, string>): Map<string, StyleProfile> {
  const out = new Map<string, StyleProfile>();
  for (const [k, v] of Object.entries(map)) {
    if (!k.startsWith(STYLE_SETTING_PREFIX)) continue;
    const p = parseStyleProfile(v);
    if (p) out.set(k.slice(STYLE_SETTING_PREFIX.length), p);
  }
  return out;
}

const TEXT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", description: "Сообщение клиенту целиком, как его отправил бы менеджер со своего телефона." } },
};

export interface StyledInput {
  managerName: string;
  female?: boolean;
  profile: StyleProfile | null;
  mode: "weekly" | "command" | "overdue";
  clientName: string;
  kazakh: boolean;
  usual: { label: string; qty: number; price: number; stock: number }[];
  focus?: string;
  lateDays?: number;
  gapDays?: number;
  shipDay?: string;
  /** Хвост переписки с клиентом, строки «клиент: …» / «я: …», до 10. */
  chatTail?: string[];
  /** Шаблон кода на случай, если модель не справилась. */
  fallback: string;
}

export interface StyledResult {
  text: string;
  /** style — написала модель в манере менеджера; template — шаблон кода. */
  source: "style" | "template";
  why: string;
}

/** Сообщение постояннику в манере менеджера. Любая ошибка — шаблон, рассылка от этого не встаёт. */
export async function styledText(input: StyledInput): Promise<StyledResult> {
  if (!openAiConfigured()) return { text: input.fallback, source: "template", why: "OpenAI не подключён" };
  if (!styleUsable(input.profile)) return { text: input.fallback, source: "template", why: "мало своих сообщений для профиля" };
  const system = [
    `Ты ${input.managerName}, менеджер по продажам цветов Ecoculture (Казахстан, Алматы), пишешь СВОЕМУ постоянному клиенту со своего WhatsApp.`,
    ...stylePromptBlock(input.profile, input.managerName),
    input.female ? "Ты женщина: «написала», «оформила»." : "",
    "Правда только из данных ниже: позиции, количества и цены. Чего нет в данных, того не обещай.",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    ...habitTaskLines(input),
    ...(input.chatTail?.length ? ["ПОСЛЕДНЕЕ ИЗ ПЕРЕПИСКИ С НИМ (чтобы попасть в тон и не повторяться):", ...input.chatTail.slice(-10).map((l) => `  ${l}`)] : []),
  ].join("\n");
  try {
    const { data } = await chatJson(system, user, "habit_message", TEXT_SCHEMA, { fast: true });
    const raw = plainTyping(String((data as { text?: unknown })?.text ?? "")).trim();
    const allowed = allowedNumbers({ prices: input.usual.map((u) => u.price), qtys: input.usual.map((u) => u.qty), extra: [input.lateDays || 0, input.gapDays || 0] });
    const check = styledTextOk(raw, allowed);
    if (!check.ok) return { text: input.fallback, source: "template", why: check.why };
    return { text: raw, source: "style", why: "" };
  } catch (e) {
    return { text: input.fallback, source: "template", why: e instanceof Error ? e.message : String(e) };
  }
}

/** Несколько текстов пачками по `batch`, пока есть время (`budgetMs`); остальным — шаблон. */
export async function styledTexts(inputs: StyledInput[], opts: { batch?: number; budgetMs?: number } = {}): Promise<StyledResult[]> {
  const batch = opts.batch ?? 5;
  const deadline = Date.now() + (opts.budgetMs ?? 30000);
  const out: StyledResult[] = [];
  for (let i = 0; i < inputs.length; i += batch) {
    if (Date.now() > deadline) {
      for (const inp of inputs.slice(i)) out.push({ text: inp.fallback, source: "template", why: "не хватило времени" });
      break;
    }
    const res = await Promise.all(inputs.slice(i, i + batch).map((inp) => styledText(inp)));
    out.push(...res);
  }
  return out;
}
