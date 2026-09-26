import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import type { Lead, LeadTouch } from "../types";

/**
 * Лиды (вкладка Leads) и касания (LeadTouches).
 *
 * Чтения обёрнуты в try/catch: пока вкладок нет (`npm run setup-sheet`),
 * страница показывает пустой список, а не падает.
 */

function toLead(r: Record<string, string>): Lead {
  return {
    leadId: r.LeadID || "",
    createdAt: toIsoDateTime(r.CreatedAt),
    createdByEmail: (r.CreatedByEmail || "").trim().toLowerCase(),
    name: r.Name || "",
    city: r.City || "",
    contactPerson: r.ContactPerson || "",
    phone: r.Phone || "",
    clientType: r.ClientType || "",
    source: r.Source || "",
    address: r.Address || "",
    note: r.Note || "",
    managerEmail: (r.ManagerEmail || "").trim().toLowerCase(),
    stage: (r.Stage || "").trim(),
    stageChangedAt: toIsoDateTime(r.StageChangedAt),
    nextTouchAt: toIsoDate(r.NextTouchAt).slice(0, 10),
    lostReason: r.LostReason || "",
    clientId: (r.ClientID || "").trim(),
    campaign: (r.Campaign || "").trim(),
    segment: (r.Segment || "").trim(),
    history: r.History || "",
    firstSeenAt: toIsoDate(r.FirstSeenAt).slice(0, 10),
    pastOrders: Number(r.PastOrders) || 0,
  };
}

function toTouch(r: Record<string, string>): LeadTouch {
  return {
    touchId: r.TouchID || "",
    leadId: r.LeadID || "",
    createdAt: toIsoDateTime(r.CreatedAt),
    managerEmail: (r.ManagerEmail || "").trim().toLowerCase(),
    channel: r.Channel || "",
    comment: r.Comment || "",
    stageFrom: r.StageFrom || "",
    stageTo: r.StageTo || "",
    nextTouchAt: toIsoDate(r.NextTouchAt).slice(0, 10),
    outcome: (r.Outcome || "").trim(),
  };
}

export async function listLeads(options: { fresh?: boolean } = {}): Promise<Lead[]> {
  try {
    const table = await readTable(SHEET_TABS.LEADS, options);
    return table.rows.map((row) => toLead(rowToRecord(SHEET_TABS.LEADS, row))).filter((l) => l.leadId && l.name);
  } catch {
    return [];
  }
}

export async function listLeadTouches(options: { fresh?: boolean } = {}): Promise<LeadTouch[]> {
  try {
    const table = await readTable(SHEET_TABS.LEAD_TOUCHES, options);
    return table.rows.map((row) => toTouch(rowToRecord(SHEET_TABS.LEAD_TOUCHES, row))).filter((t) => t.touchId && t.leadId);
  } catch {
    return [];
  }
}

/** Лид и номер его строки — свежим чтением: по нему будем писать. */
export async function findLeadRow(leadId: string): Promise<{ lead: Lead; rowNumber: number } | null> {
  const table = await readTable(SHEET_TABS.LEADS, { fresh: true });
  for (let i = 0; i < table.rows.length; i++) {
    const lead = toLead(rowToRecord(SHEET_TABS.LEADS, table.rows[i]));
    if (lead.leadId === leadId) return { lead, rowNumber: table.rowNumbers[i] };
  }
  return null;
}

export async function getLead(leadId: string, options: { fresh?: boolean } = {}): Promise<Lead | null> {
  if (options.fresh) return (await findLeadRow(leadId))?.lead ?? null;
  return (await listLeads()).find((l) => l.leadId === leadId) ?? null;
}

export type NewLead = Omit<
  Lead,
  "leadId" | "createdAt" | "stage" | "stageChangedAt" | "nextTouchAt" | "lostReason" | "clientId" | "campaign" | "segment" | "history" | "firstSeenAt" | "pastOrders"
> &
  Partial<Pick<Lead, "campaign" | "segment" | "history" | "firstSeenAt" | "pastOrders">>;

function leadRecord(input: NewLead, nowIso: string, nextTouchAt = ""): Record<string, unknown> {
  return {
    LeadID: generateId("LEAD"),
    CreatedAt: nowIso,
    CreatedByEmail: input.createdByEmail,
    Name: input.name,
    City: input.city,
    ContactPerson: input.contactPerson,
    Phone: input.phone,
    ClientType: input.clientType,
    Source: input.source,
    Address: input.address,
    Note: input.note,
    ManagerEmail: input.managerEmail,
    Stage: "new",
    StageChangedAt: nowIso,
    NextTouchAt: nextTouchAt,
    LostReason: "",
    ClientID: "",
    Campaign: input.campaign ?? "",
    Segment: input.segment ?? "",
    History: input.history ?? "",
    FirstSeenAt: input.firstSeenAt ?? "",
    PastOrders: input.pastOrders ? input.pastOrders : "",
  };
}

export async function createLead(input: NewLead, nextTouchAt = ""): Promise<string> {
  const record = leadRecord(input, new Date().toISOString(), nextTouchAt);
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.LEADS, records: [record] }]);
  return String(record.LeadID);
}

/** Пачка лидов из файла — одним запросом (грабли 1.15, 1.16). */
export async function createLeads(inputs: NewLead[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const now = new Date().toISOString();
  await commitAtomic([{ kind: "append", tab: SHEET_TABS.LEADS, records: inputs.map((i) => leadRecord(i, now)) }]);
  return inputs.length;
}

/**
 * Раздача: у многих лидов меняется менеджер — одним атомарным запросом.
 * Читается СВЕЖИМ (грабли 1.15): отдаём только тех, кто всё ещё ничей или всё
 * ещё у того, у кого забираем, — иначе раздача затёрла бы взятый за эту минуту.
 */
export async function reassignLeads(
  assignments: { leadId: string; managerEmail: string }[],
  stillOwnedBy: (lead: Lead) => boolean
): Promise<number> {
  if (assignments.length === 0) return 0;
  const table = await readTable(SHEET_TABS.LEADS, { fresh: true });
  const rowOf = new Map<string, { lead: Lead; rowNumber: number }>();
  table.rows.forEach((row, i) => {
    const lead = toLead(rowToRecord(SHEET_TABS.LEADS, row));
    if (lead.leadId) rowOf.set(lead.leadId, { lead, rowNumber: table.rowNumbers[i] });
  });
  const ops = [];
  for (const a of assignments) {
    const found = rowOf.get(a.leadId);
    if (!found || !stillOwnedBy(found.lead)) continue;
    ops.push({ kind: "update" as const, tab: SHEET_TABS.LEADS, rowNumber: found.rowNumber, changes: { ManagerEmail: a.managerEmail } });
  }
  if (ops.length > 0) await commitAtomic(ops);
  return ops.length;
}

/** Правка ячеек лида: только изменившиеся, одним запросом. */
export async function updateLead(leadId: string, changes: Record<string, string>): Promise<Lead> {
  const found = await findLeadRow(leadId);
  if (!found) throw new Error("Лид не найден — возможно, его удалили в таблице");
  if (Object.keys(changes).length > 0) {
    await commitAtomic([{ kind: "update", tab: SHEET_TABS.LEADS, rowNumber: found.rowNumber, changes }]);
  }
  return found.lead;
}

/**
 * Касание и правка лида — ОДНИМ атомарным запросом (грабли 1.16): иначе при
 * отказе Google на втором шаге стадия сдвинулась бы без касания или наоборот.
 */
export async function addTouch(
  leadId: string,
  touch: Omit<LeadTouch, "touchId" | "leadId" | "createdAt" | "outcome"> & { outcome?: string },
  leadChanges: Record<string, string>,
  nowIso: string,
  /** Номер строки лида, если его только что прочитали свежим (лишнее чтение 3 700 строк ни к чему). */
  knownRowNumber?: number
): Promise<void> {
  const found = knownRowNumber ? { rowNumber: knownRowNumber } : await findLeadRow(leadId);
  if (!found) throw new Error("Лид не найден — возможно, его удалили в таблице");
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.LEAD_TOUCHES,
      records: [
        {
          TouchID: generateId("TCH"),
          LeadID: leadId,
          CreatedAt: nowIso,
          ManagerEmail: touch.managerEmail,
          Channel: touch.channel,
          Comment: touch.comment,
          StageFrom: touch.stageFrom,
          StageTo: touch.stageTo,
          NextTouchAt: touch.nextTouchAt,
          Outcome: touch.outcome ?? "",
        },
      ],
    },
    ...(Object.keys(leadChanges).length > 0
      ? [{ kind: "update" as const, tab: SHEET_TABS.LEADS, rowNumber: found.rowNumber, changes: leadChanges }]
      : []),
  ]);
}
