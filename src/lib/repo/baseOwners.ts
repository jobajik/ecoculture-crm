import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";

// ---------------------------------------------------------------------------
// Чей человек — запись (26.11.2026, «Клиенты → База»). Менеджер пишется в карточку клиента (`Clients.ManagerEmail`) и в
// лид (`Leads.ManagerEmail`); у одного человека бывает и то, и другое, поэтому меняются вместе, одной записью.
// Читаем свежим (грабли 1.15) и пишем только то, что правда меняется; большие списки — пачками.
// ---------------------------------------------------------------------------

const low = (s: string) => (s || "").trim().toLowerCase();

export async function setOwners(input: {
  clients: { clientId: string; managerEmail: string }[];
  leads: { leadId: string; managerEmail: string }[];
  /** Менять только то, что всё ещё записано за этим человеком (или ни за кем — пустая строка); нет — без проверки. */
  onlyFrom?: (current: string) => boolean;
}): Promise<{ clients: number; leads: number }> {
  const ops: WriteOp[] = [];
  let clients = 0;
  let leads = 0;
  const still = (current: string) => !input.onlyFrom || input.onlyFrom(low(current));
  if (input.clients.length) {
    const want = new Map(input.clients.map((c) => [c.clientId, c.managerEmail]));
    const t = await readTable(SHEET_TABS.CLIENTS, { fresh: true });
    t.rows.forEach((row, i) => {
      const r = rowToRecord(SHEET_TABS.CLIENTS, row);
      const to = want.get(r.ClientID || "");
      if (to === undefined || low(r.ManagerEmail) === low(to) || !still(r.ManagerEmail)) return;
      ops.push({ kind: "update", tab: SHEET_TABS.CLIENTS, rowNumber: t.rowNumbers[i], changes: { ManagerEmail: to } });
      clients++;
    });
  }
  if (input.leads.length) {
    const want = new Map(input.leads.map((l) => [l.leadId, l.managerEmail]));
    const t = await readTable(SHEET_TABS.LEADS, { fresh: true });
    t.rows.forEach((row, i) => {
      const r = rowToRecord(SHEET_TABS.LEADS, row);
      const to = want.get(r.LeadID || "");
      if (to === undefined || low(r.ManagerEmail) === low(to) || !still(r.ManagerEmail)) return;
      ops.push({ kind: "update", tab: SHEET_TABS.LEADS, rowNumber: t.rowNumbers[i], changes: { ManagerEmail: to } });
      leads++;
    });
  }
  for (let i = 0; i < ops.length; i += 400) await commitAtomic(ops.slice(i, i + 400));
  return { clients, leads };
}
