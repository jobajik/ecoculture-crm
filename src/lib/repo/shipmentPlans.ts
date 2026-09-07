import { appendRows, readTable, rowToRecord, updateRows, SHEET_TABS } from "../sheets";

/**
 * План отгрузок по направлениям. Ведётся руководителем отдела продаж на вкладке
 * ShipmentPlans:
 *
 *   Period   Direction   FlowerType      TargetStems  TargetAmount  UpdatedAt  UpdatedByEmail
 *   2026-09  Астана      rose            12000        6000000       ...        rop@company.kz
 *   2026-09  Астана      chrysanthemum   4000         1200000       ...        rop@company.kz
 *
 * Ключ строки — Period + Direction + FlowerType. При повторном сохранении
 * строка переписывается, а не дублируется: иначе за полгода правок вкладка
 * превратилась бы в кашу, где непонятно, какая цифра актуальна.
 */
export interface ShipmentPlanRow {
  period: string;
  direction: string;
  flowerType: string;
  targetStems: number;
  targetAmount: number;
  updatedAt: string;
  updatedByEmail: string;
}

/** Значение, которое пришло из формы: только цифры, остальное проставим сами. */
export interface ShipmentPlanInput {
  period: string;
  direction: string;
  flowerType: string;
  targetStems: number;
  targetAmount: number;
}

function toNumber(raw: string): number {
  // Из таблицы число может приехать как «12 000», «12000,5» или «12,000.5».
  const cleaned = String(raw || "")
    .replace(/\s| /g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function shipmentPlanKey(period: string, direction: string, flowerType: string): string {
  return `${period}|${direction}|${flowerType}`;
}

export async function listShipmentPlans(): Promise<ShipmentPlanRow[]> {
  try {
    const table = await readTable(SHEET_TABS.SHIPMENT_PLANS);
    return table.rows
      .map((row) => {
        const record = rowToRecord(SHEET_TABS.SHIPMENT_PLANS, row);
        return {
          period: (record.Period || "").trim(),
          direction: (record.Direction || "").trim(),
          flowerType: (record.FlowerType || "").trim(),
          targetStems: toNumber(record.TargetStems),
          targetAmount: toNumber(record.TargetAmount),
          updatedAt: (record.UpdatedAt || "").trim(),
          updatedByEmail: (record.UpdatedByEmail || "").trim().toLowerCase(),
        };
      })
      .filter((p) => p.period && p.direction && p.flowerType);
  } catch {
    // Вкладки может не быть, если таблицу ещё не пересобирали — это не ошибка,
    // просто планов пока нет.
    return [];
  }
}

export async function getShipmentPlansForPeriod(
  period: string
): Promise<Map<string, ShipmentPlanRow>> {
  const plans = await listShipmentPlans();
  const map = new Map<string, ShipmentPlanRow>();
  for (const plan of plans) {
    if (plan.period === period) {
      map.set(shipmentPlanKey(plan.period, plan.direction, plan.flowerType), plan);
    }
  }
  return map;
}

/**
 * Записывает планы: существующие строки переписывает, новые дописывает.
 * Таблица читается один раз, запись идёт двумя запросами (пакетное обновление
 * и пакетное добавление) — сколько бы строк ни правили.
 */
export async function saveShipmentPlans(
  inputs: ShipmentPlanInput[],
  updatedByEmail: string
): Promise<{ updated: number; created: number }> {
  if (inputs.length === 0) return { updated: 0, created: 0 };

  const table = await readTable(SHEET_TABS.SHIPMENT_PLANS);
  const rowByKey = new Map<string, number>();
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.SHIPMENT_PLANS, row);
    const key = shipmentPlanKey(
      (record.Period || "").trim(),
      (record.Direction || "").trim(),
      (record.FlowerType || "").trim()
    );
    // Если в таблице руками наплодили дублей, держимся первой строки:
    // читаем мы тоже сверху вниз, значит правим ровно ту, что показываем.
    if (!rowByKey.has(key)) rowByKey.set(key, table.rowNumbers[idx]);
  });

  const updatedAt = new Date().toISOString();
  const updates: { rowNumber: number; record: Record<string, unknown> }[] = [];
  const creates: Record<string, unknown>[] = [];

  for (const input of inputs) {
    const record = {
      Period: input.period,
      Direction: input.direction,
      FlowerType: input.flowerType,
      TargetStems: input.targetStems,
      TargetAmount: input.targetAmount,
      UpdatedAt: updatedAt,
      UpdatedByEmail: updatedByEmail,
    };
    const rowNumber = rowByKey.get(
      shipmentPlanKey(input.period, input.direction, input.flowerType)
    );
    if (rowNumber) updates.push({ rowNumber, record });
    else creates.push(record);
  }

  await updateRows(SHEET_TABS.SHIPMENT_PLANS, updates);
  await appendRows(SHEET_TABS.SHIPMENT_PLANS, creates);

  return { updated: updates.length, created: creates.length };
}
