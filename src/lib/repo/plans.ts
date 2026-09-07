import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";

/**
 * Планы продаж. Ведутся на вкладке Plans в Google-таблице:
 *
 *   Period      ManagerEmail          TargetAmount   TargetStems
 *   2026-09     ivan@company.kz       4500000        120000
 *   2026-09     aigerim@company.kz    3000000        80000
 *
 * Period — месяц в формате ГГГГ-ММ. План компании считается как сумма планов
 * менеджеров, отдельной строки для него не нужно.
 */
export interface PlanRow {
  period: string;
  managerEmail: string;
  targetAmount: number;
  targetStems: number;
}

export async function listPlans(): Promise<PlanRow[]> {
  try {
    const table = await readTable(SHEET_TABS.PLANS);
    return table.rows
      .map((row) => {
        const record = rowToRecord(SHEET_TABS.PLANS, row);
        return {
          period: (record.Period || "").trim(),
          managerEmail: (record.ManagerEmail || "").trim().toLowerCase(),
          targetAmount: Number(String(record.TargetAmount || "").replace(/\s/g, "").replace(",", ".")) || 0,
          targetStems: Number(String(record.TargetStems || "").replace(/\s/g, "").replace(",", ".")) || 0,
        };
      })
      .filter((p) => p.period && p.managerEmail);
  } catch {
    return [];
  }
}

/** Планы конкретного месяца, ключ — email менеджера. */
export async function getPlansForPeriod(period: string): Promise<Map<string, PlanRow>> {
  const plans = await listPlans();
  const map = new Map<string, PlanRow>();
  for (const plan of plans) {
    if (plan.period === period) map.set(plan.managerEmail, plan);
  }
  return map;
}

/**
 * Сохраняет планы менеджеров: строка на месяц и менеджера. Существующую строку
 * переписываем, новую дописываем — чтобы правка плана не плодила дубли, из
 * которых потом непонятно, какой план настоящий.
 */
export async function savePlans(
  inputs: PlanRow[]
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };

  const table = await readTable(SHEET_TABS.PLANS);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.PLANS, row);
    const key = `${(record.Period || "").trim()}|${(record.ManagerEmail || "").trim().toLowerCase()}`;
    if (!rowByKey.has(key)) rowByKey.set(key, table.rowNumbers[idx]);
  });

  const updates: { rowNumber: number; record: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];

  for (const input of inputs) {
    const email = input.managerEmail.trim().toLowerCase();
    const record = {
      Period: input.period,
      ManagerEmail: email,
      TargetAmount: input.targetAmount,
      TargetStems: input.targetStems,
    };
    const rowNumber = rowByKey.get(`${input.period}|${email}`);
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.PLANS, updates);
  await appendRows(SHEET_TABS.PLANS, creates);

  return { updated: updates.length, created: creates.length };
}
