import { FARMS, FARM_LABELS } from "./constants";

// ---------------------------------------------------------------------------
// «Оплаты»: продажи каждого менеджера по компаниям (12.10.2026, бухгалтер Юлия: «чтобы был фильтр по менеджерам
// и каждые продажи по конкретной компании на каждого менеджера»). Rose Farm и Есентай — разные ТОО и разные счета,
// а в группе менеджера стояла одна общая сумма: сколько он продал розы, а сколько хризантемы, приходилось
// складывать по заявкам глазами.
//
// Считается из тех же строк, что и список под таблицей (уже отфильтрованных): иначе у менеджера в таблице стояло бы
// одно число, а в его раскрытой группе — другое. Получено по компании — не больше её счёта: переплата не продажа.
// Лежит в `lib`, а не в компоненте: его зовёт и проверка (грабли 1.8).
// ---------------------------------------------------------------------------

/** Компании в привычном порядке — колонки таблицы. */
export const FINANCE_FARMS: { farm: string; label: string }[] = [FARMS.ROSE_FARM, FARMS.ESENTAI].map((farm) => ({
  farm,
  label: FARM_LABELS[farm] ?? farm,
}));

export interface ManagerFarmRow {
  managerEmail: string;
  managerName: string;
  orders: number;
  byFarm: Record<string, { amount: number; paid: number }>;
  amount: number;
  paid: number;
}

interface RowInput {
  managerEmail: string;
  managerName: string;
  amount: number;
  paidAmount: number;
  farms: { farm: string; amount: number; paidAmount: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyFarms(): Record<string, { amount: number; paid: number }> {
  return Object.fromEntries(FINANCE_FARMS.map((f) => [f.farm, { amount: 0, paid: 0 }]));
}

/** Строка на менеджера (крупные сверху) и итог по всем — по уже отфильтрованным заявкам. */
export function managerFarmSummary(rows: RowInput[]): { rows: ManagerFarmRow[]; total: ManagerFarmRow } {
  const map = new Map<string, ManagerFarmRow>();
  const total: ManagerFarmRow = { managerEmail: "", managerName: "Всего", orders: 0, byFarm: emptyFarms(), amount: 0, paid: 0 };
  for (const r of rows) {
    const m = map.get(r.managerEmail) ?? {
      managerEmail: r.managerEmail,
      managerName: r.managerName,
      orders: 0,
      byFarm: emptyFarms(),
      amount: 0,
      paid: 0,
    };
    m.orders += 1;
    total.orders += 1;
    for (const f of r.farms) {
      const paid = Math.min(f.paidAmount, f.amount);
      for (const target of [m, total]) {
        const cell = target.byFarm[f.farm] ?? (target.byFarm[f.farm] = { amount: 0, paid: 0 });
        cell.amount = round2(cell.amount + f.amount);
        cell.paid = round2(cell.paid + paid);
      }
    }
    const paid = Math.min(r.paidAmount, r.amount);
    for (const target of [m, total]) {
      target.amount = round2(target.amount + r.amount);
      target.paid = round2(target.paid + paid);
    }
    map.set(r.managerEmail, m);
  }
  return { rows: Array.from(map.values()).sort((a, b) => b.amount - a.amount), total };
}

/** Менеджеры для фильтра: по имени, без повторов. */
export function managerOptions(rows: { managerEmail: string; managerName: string }[]): { email: string; name: string }[] {
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.managerEmail)) map.set(r.managerEmail, r.managerName || r.managerEmail);
  return Array.from(map, ([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
