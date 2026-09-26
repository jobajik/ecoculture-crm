import type { WaMessage } from "./types";
import { MAX_MESSAGE_TEXT } from "./whatsapp";

// ---------------------------------------------------------------------------
// Переписка из «Экспорта чата» WhatsApp (Ещё → Экспорт чата → Без медиафайлов).
//
// Зачем, если есть Green API: (1) проверить разбор до подключения рабочего
// номера и (2) разобрать переписку с ЛИЧНОГО номера менеджера — он в Green API
// не подключён. Менеджер загружает файл в карточке лида, отмечает, какие имена в
// переписке — наши, и переписка ложится во вкладку WaMessages как обычная.
//
// Форматы, которые встречаются (зависят от телефона и языка):
//   Android:  26.09.2026, 14:05 - Айгуль: текст
//             9/26/26, 2:05 PM - Aigul: text
//   iPhone:   [26.09.2026, 14:05:33] Айгуль: текст
// Строка без «дата, время» в начале — продолжение предыдущего сообщения.
// Время в файле местное — считаем его временем Алматы (UTC+5).
//
// Модуль чистый: разбор идёт и в браузере (предпросмотр), и на сервере.
// ---------------------------------------------------------------------------

export interface ExportLine {
  at: string;
  author: string;
  text: string;
}

export interface ParsedExport {
  messages: ExportLine[];
  /** Все авторы по числу сообщений — чтобы отметить, кто из них «мы». */
  authors: { name: string; count: number }[];
}

const ALMATY_OFFSET_HOURS = 5;
/** Больше не берём: разбору нужны свежие, а ячейки таблицы не резиновые. */
export const MAX_IMPORT_MESSAGES = 1500;

// [дата, время] автор: текст   или   дата, время - автор: текст
const LINE = /^‎?\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:[-–—]\s*)?(.*)$/;

const MEDIA = /^(<.*(медиа|media|omitted|опущен|пропущен|без медиа).*>|‎?(image|video|audio|document|sticker|GIF) omitted|‎?(изображение|видео|аудио|документ|стикер) (отсутствует|опущено|пропущено))$/i;

function toIso(d: number, m: number, y: number, hh: number, mm: number, ss: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const t = Date.UTC(y, m - 1, d, hh - ALMATY_OFFSET_HOURS, mm, ss);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * День и месяц: в русском экспорте «дд.мм», в английском «м/д». Если первое
 * число больше 12 — это точно день; разделитель «/» — американский порядок.
 */
function dayMonth(a: number, b: number, sep: string): [number, number] {
  if (a > 12) return [a, b];
  if (b > 12) return [b, a];
  return sep === "/" ? [b, a] : [a, b];
}

export function parseWhatsAppExport(raw: string): ParsedExport {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: ExportLine[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/[‎‏‪-‮]/g, "");
    const m = line.match(LINE);
    if (m) {
      const sep = line.match(/^\[?\d{1,2}([./-])/)?.[1] ?? ".";
      const [d, mo] = dayMonth(Number(m[1]), Number(m[2]), sep);
      let hh = Number(m[4]);
      const ampm = (m[7] || "").toLowerCase().replace(/[.\s]/g, "");
      if (ampm === "pm" && hh < 12) hh += 12;
      if (ampm === "am" && hh === 12) hh = 0;
      const at = toIso(d, mo, Number(m[3]), hh, Number(m[5]), Number(m[6] || 0));
      const rest = m[8] || "";
      const colon = rest.indexOf(": ");
      // Служебные строки («Сообщения защищены сквозным шифрованием…») без автора
      // пропускаем — это не разговор.
      if (!at || colon <= 0 || colon > 60) continue;
      const author = rest.slice(0, colon).trim();
      const text = rest.slice(colon + 2).trim();
      out.push({ at, author, text: MEDIA.test(text) ? "[файл]" : text });
    } else if (out.length > 0 && line.trim()) {
      out[out.length - 1].text += `\n${line}`;
    }
  }
  const counts = new Map<string, number>();
  for (const x of out) counts.set(x.author, (counts.get(x.author) ?? 0) + 1);
  return {
    messages: out,
    authors: Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Короткий устойчивый номер: одна и та же строка при повторной загрузке склеится. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/**
 * Экспорт → сообщения для WaMessages. `ours` — имена, которые в переписке
 * пишут от нас (менеджер, общий номер). Номер собеседника — телефон лида:
 * в самом экспорте его нет.
 */
export function exportToMessages(parsed: ParsedExport, ours: string[], phoneDigits: string): WaMessage[] {
  const mine = new Set(ours);
  const list = parsed.messages.slice(-MAX_IMPORT_MESSAGES);
  const seen = new Map<string, number>();
  return list.map((x) => {
    const base = `${phoneDigits}|${x.at}|${x.author}|${x.text}`;
    // Два одинаковых сообщения в одну минуту («ок», «ок») — разные сообщения.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const direction = mine.has(x.author) ? "out" : "in";
    const text = x.text.length > MAX_MESSAGE_TEXT ? `${x.text.slice(0, MAX_MESSAGE_TEXT)}…` : x.text;
    return {
      messageId: `imp-${hash(`${base}|${n}`)}`,
      at: x.at,
      chatId: `${phoneDigits}@c.us`,
      phone: phoneDigits,
      direction,
      type: "text",
      text,
      mediaUrl: "",
      senderName: direction === "in" ? x.author.slice(0, 120) : "",
      source: "import",
    } satisfies WaMessage;
  });
}

/** Цифры телефона лида для chatId: «8 701 …» → «7701…». Пусто — номера нет. */
export function leadPhoneDigits(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = `7${d.slice(1)}`;
  if (d.length === 10) d = `7${d}`;
  return d.length >= 10 ? d : "";
}
