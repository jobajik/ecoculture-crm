import { readTable, rowToRecord, SHEET_TABS } from "../sheets";

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
