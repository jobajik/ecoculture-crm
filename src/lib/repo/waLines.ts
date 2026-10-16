import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDateTime } from "../sheetDate";
import { greenConfig, greenLeadsConfig, type GreenConfig } from "../greenApi";
import { openSecret } from "../secretBox";
import { isManagerLine, type AssistantMode, type WaLine } from "../waLines";

/**
 * Номера WhatsApp менеджеров (вкладка WaLines) и журнал ИИ-помощника (AssistantLog).
 * Номера читаются не чаще раза в минуту (вебхук спрашивает их на КАЖДОЕ сообщение,
 * а лимит Google общий — грабли 1.17); запись сбрасывает память. Пока вкладок нет
 * (`npm run setup-sheet`), чтения отдают пустое.
 */

const CACHE_MS = 60000;
type Cache = { at: number; lines: WaLine[] };
const g = globalThis as unknown as { __waLines?: Cache };

function toLine(r: Record<string, string>): WaLine {
  const mode = (r.Assistant || "").trim();
  const active = (r.Active || "").trim().toUpperCase();
  return {
    code: (r.Code || "").trim(),
    managerEmail: (r.ManagerEmail || "").trim().toLowerCase(),
    label: (r.Label || "").trim(),
    url: (r.Url || "").trim().replace(/\/+$/, ""),
    instance: String(r.Instance || "").trim(),
    tokenEnc: (r.TokenEnc || "").trim(),
    active: !["FALSE", "НЕТ", "NO", "0", "-"].includes(active),
    assistant: (mode === "off" ? "off" : "on") as AssistantMode,
    createdAt: toIsoDateTime(r.CreatedAt),
    updatedAt: toIsoDateTime(r.UpdatedAt),
    phone: String(r.Phone || "").replace(/\D/g, ""),
    state: (r.State || "").trim(),
    stateAt: toIsoDateTime(r.StateAt),
  };
}

async function readLines(fresh: boolean): Promise<{ line: WaLine; rowNumber: number }[]> {
  try {
    const table = await readTable(SHEET_TABS.WA_LINES, fresh ? { fresh: true } : undefined);
    return table.rows
      .map((row, i) => ({ line: toLine(rowToRecord(SHEET_TABS.WA_LINES, row)), rowNumber: table.rowNumbers[i] }))
      .filter((x) => isManagerLine(x.line.code));
  } catch {
    return [];
  }
}

export async function listWaLines(options: { fresh?: boolean } = {}): Promise<WaLine[]> {
  if (!options.fresh && g.__waLines && Date.now() - g.__waLines.at < CACHE_MS) return g.__waLines.lines;
  const lines = (await readLines(!!options.fresh)).map((x) => x.line);
  g.__waLines = { at: Date.now(), lines };
  return lines;
}

export function forgetWaLines(): void {
  g.__waLines = undefined;
}

function lineRecord(l: WaLine): Record<string, unknown> {
  return {
    Code: l.code,
    ManagerEmail: l.managerEmail,
    Label: l.label,
    Url: l.url,
    Instance: l.instance,
    TokenEnc: l.tokenEnc,
    Active: l.active ? "TRUE" : "FALSE",
    Assistant: l.assistant,
    CreatedAt: l.createdAt,
    UpdatedAt: l.updatedAt,
    Phone: l.phone,
    State: l.state,
    StateAt: l.stateAt,
  };
}

/** Записать номер целиком (новый — строкой в конец, существующий — правкой его строки). */
export async function saveWaLine(line: WaLine): Promise<void> {
  const rows = await readLines(true);
  const found = rows.find((x) => x.line.code === line.code);
  await commitAtomic([
    found
      ? { kind: "update", tab: SHEET_TABS.WA_LINES, rowNumber: found.rowNumber, changes: lineRecord(line) }
      : { kind: "append", tab: SHEET_TABS.WA_LINES, records: [lineRecord(line)] },
  ]);
  forgetWaLines();
}

/** Поменять несколько полей номера (режим помощника, состояние, номер телефона). */
export async function updateWaLine(code: string, changes: Partial<Record<"Assistant" | "Active" | "State" | "StateAt" | "Phone" | "UpdatedAt" | "Label", string>>): Promise<boolean> {
  const rows = await readLines(true);
  const found = rows.find((x) => x.line.code === code);
  if (!found) return false;
  await commitAtomic([{ kind: "update", tab: SHEET_TABS.WA_LINES, rowNumber: found.rowNumber, changes }]);
  forgetWaLines();
  return true;
}

/** Ключи Green API номера менеджера — расшифрованные. Нет, выключен или не расшифровался — null. */
export function managerLineConfig(line: WaLine | undefined | null): GreenConfig | null {
  if (!line || !line.active || !line.instance) return null;
  const token = openSecret(line.tokenEnc);
  if (!token) return null;
  return { url: line.url || "https://api.green-api.com", instance: line.instance, token };
}

/** Ключи любой линии: "" — основной номер, "leads" — Земфира, "m-…" — менеджер. */
export async function lineConfig(line: string): Promise<GreenConfig | null> {
  if (!line) return greenConfig();
  if (line === "leads") return greenLeadsConfig();
  if (!isManagerLine(line)) return null;
  return managerLineConfig((await listWaLines()).find((l) => l.code === line));
}

// --- Журнал помощника -----------------------------------------------------------------

export interface AssistantLogRow {
  logId: string;
  at: string;
  line: string;
  phone: string;
  /** auto — ответил помощник сам; crm — отправил человек из CRM; note — нужен менеджер. */
  kind: "auto" | "crm" | "note";
  messageId: string;
  text: string;
  note: string;
  byEmail: string;
  doneAt: string;
  rowNumber: number;
}

export async function listAssistantLog(options: { fresh?: boolean } = {}): Promise<AssistantLogRow[]> {
  try {
    const table = await readTable(SHEET_TABS.ASSISTANT_LOG, options.fresh ? { fresh: true } : undefined);
    return table.rows
      .map((row, i) => {
        const r = rowToRecord(SHEET_TABS.ASSISTANT_LOG, row);
        const kind = (r.Kind || "").trim();
        return {
          logId: r.LogID || "",
          at: toIsoDateTime(r.At),
          line: (r.Line || "").trim(),
          phone: String(r.Phone || "").replace(/\D/g, ""),
          kind: (kind === "crm" || kind === "note" ? kind : "auto") as AssistantLogRow["kind"],
          messageId: (r.MessageID || "").trim(),
          text: r.Text || "",
          note: r.Note || "",
          byEmail: (r.ByEmail || "").trim().toLowerCase(),
          doneAt: toIsoDateTime(r.DoneAt),
          rowNumber: table.rowNumbers[i],
        };
      })
      .filter((x) => x.logId);
  } catch {
    return [];
  }
}

export async function appendAssistantLog(rows: Omit<AssistantLogRow, "logId" | "rowNumber" | "doneAt">[]): Promise<void> {
  if (rows.length === 0) return;
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.ASSISTANT_LOG,
      records: rows.map((r) => ({
        LogID: generateId("AST"),
        At: r.at,
        Line: r.line,
        Phone: r.phone,
        Kind: r.kind,
        MessageID: r.messageId,
        Text: r.text.slice(0, 4000),
        Note: r.note.slice(0, 500),
        ByEmail: r.byEmail,
        DoneAt: "",
      })),
    },
  ]);
}

/** Записки «нужен менеджер» по номеру — закрыть (менеджер ответил или нажал «Сделано»). */
export async function closeAssistantNotes(rowNumbers: number[], nowIso: string): Promise<void> {
  if (rowNumbers.length === 0) return;
  await commitAtomic(rowNumbers.map((rowNumber) => ({ kind: "update" as const, tab: SHEET_TABS.ASSISTANT_LOG, rowNumber, changes: { DoneAt: nowIso } })));
}
