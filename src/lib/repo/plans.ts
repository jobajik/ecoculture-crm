import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";
import {
  aggregateManagerPlans,
  cleanPlanFlower,
  type ManagerPlanTotal,
} from "../managerPlans";

/**
 * Планы продаж. Ведутся на вкладке Plans в Google-таблице:
 *
 *   Period      ManagerEmail          TargetAmount   TargetStems   FlowerType
 *   2026-09     ivan@company.kz       2500000        70000         rose
 *   2026-09     ivan@company.kz       1500000        40000         chrysanthemum
 *   2026-09     aigerim@company.kz    3000000        80000         rose
 *
 * Period — месяц в формате ГГГГ-ММ, строка — на месяц, менеджера и ЦВЕТОК.
 * План менеджера на месяц — это сумма его строк по цветкам, отдельной строки
 * для него нет; план отдела — сумма планов менеджеров. Почему так и что делать
 * со строками старой схемы (пустой `FlowerType`) — в `src/lib/managerPlans.ts`.
 */
export interface PlanRow {
  period: string;
  managerEmail: string;
  /** Пусто — строка старой схемы, план без разбивки по цветку. */
  flowerType: string;
  targetAmount: number;
  targetStems: number;
}

function toNumber(value: unknown): number {
  return Number(String(value ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
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
          flowerType: cleanPlanFlower(record.FlowerType),
          targetAmount: toNumber(record.TargetAmount),
          targetStems: toNumber(record.TargetStems),
        };
      })
      .filter((p) => p.period && p.managerEmail);
  } catch {
    return [];
  }
}

/**
 * Планы конкретного месяца, ключ — email менеджера.
 *
 * Возвращается ИТОГ по менеджеру (сумма его цветков) плюс разбивка `byFlower`.
 * Благодаря этому рейтинг и план-факт, которым разбивка не нужна, работают без
 * единой правки: у них как было `plan.targetAmount`, так и осталось.
 */
export async function getPlansForPeriod(period: string): Promise<Map<string, ManagerPlanTotal>> {
  const plans = await listPlans();
  return aggregateManagerPlans(plans, period);
}

/**
 * Сохраняет планы менеджеров: строка на месяц, менеджера и цветок. Существующую
 * строку переписываем, новую дописываем — чтобы правка плана не плодила дубли,
 * из которых потом непонятно, какой план настоящий.
 *
 * Заодно ОБНУЛЯЕТСЯ старая строка без цветка, если по этому менеджеру и месяцу
 * она есть: с появлением разбивки её число перестаёт участвовать в счёте, и
 * оставить его в таблице значило бы держать там второе число об одном и том же
 * месяце. Через полгода спорить с ним будет некому.
 */
export async function savePlans(
  inputs: PlanRow[]
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };

  const table = await readTable(SHEET_TABS.PLANS);
  const rowByKey = new Map<string, number>();
  const legacyRows = new Map<string, { rowNumber: number; amount: number; stems: number }>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.PLANS, row);
    const period = (record.Period || "").trim();
    const email = (record.ManagerEmail || "").trim().toLowerCase();
    const flower = cleanPlanFlower(record.FlowerType);
    const key = `${period}|${email}|${flower}`;
    if (!rowByKey.has(key)) rowByKey.set(key, table.rowNumbers[idx]);
    if (!flower && !legacyRows.has(`${period}|${email}`)) {
      legacyRows.set(`${period}|${email}`, {
        rowNumber: table.rowNumbers[idx],
        amount: toNumber(record.TargetAmount),
        stems: toNumber(record.TargetStems),
      });
    }
  });

  const updates: { rowNumber: number; record: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];
  const supersededLegacy = new Set<string>();

  for (const input of inputs) {
    const email = input.managerEmail.trim().toLowerCase();
    const flower = cleanPlanFlower(input.flowerType);
    const record = {
      Period: input.period,
      ManagerEmail: email,
      TargetAmount: input.targetAmount,
      TargetStems: input.targetStems,
      FlowerType: flower,
    };
    const rowNumber = rowByKey.get(`${input.period}|${email}|${flower}`);
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
    if (flower) supersededLegacy.add(`${input.period}|${email}`);
  }

  for (const key of supersededLegacy) {
    const legacy = legacyRows.get(key);
    if (!legacy) continue;
    if (legacy.amount === 0 && legacy.stems === 0) continue;
    const [period, email] = key.split("|");
    updates.push({
      rowNumber: legacy.rowNumber,
      record: {
        Period: period,
        ManagerEmail: email,
        TargetAmount: 0,
        TargetStems: 0,
        FlowerType: "",
      },
    });
  }

  await updateRows(SHEET_TABS.PLANS, updates);
  await appendRows(SHEET_TABS.PLANS, creates);

  return { updated: updates.length, created: creates.length };
}
