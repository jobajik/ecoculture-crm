import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { listWriteoffs } from "@/lib/repo/writeoffs";
import { listUsers } from "@/lib/repo/users";
import { listClients } from "@/lib/repo/clients";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { settingsMap } from "@/lib/repo/broadcasts";
import { nameIndex } from "@/lib/personName";
import { ROLES } from "@/lib/constants";
import type { AiAdvice, AiPlanInput, Scenario } from "@/lib/aiPlan";
import { forecastByWeek } from "../data";

/** Ключ настройки, где лежит последний сохранённый план с ИИ за месяц (без новой вкладки и `setup-sheet`). */
export const aiPlanSettingKey = (month: string) => `AiPlan:${month}`;

/** Что сохранено по кнопке «Сохранить план»: кто, когда, какой сценарий и что сказал ИИ. */
export interface AiPlanSnapshot {
  at: string;
  by: string;
  scenario: Scenario;
  model: string;
  comment: string;
  advice: AiAdvice | null;
  managers: { email: string; sum: number }[];
  directions: { direction: string; stems: number }[];
}

export function parseSnapshot(raw: string | undefined): AiPlanSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as AiPlanSnapshot;
    return v && typeof v === "object" && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Всё для расчёта плана — одним чтением таблицы (лимит Google общий на компанию, грабли 1.17). */
export async function loadAiPlanInput(month: string, today: string, scenario: Scenario): Promise<{ input: AiPlanInput; snapshot: AiPlanSnapshot | null }> {
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PLANS,
    SHEET_TABS.HARVEST_FORECAST,
    SHEET_TABS.HARVEST_MIX,
    SHEET_TABS.BATCHES,
    SHEET_TABS.WRITEOFFS,
    SHEET_TABS.SETTINGS,
  ]).catch(() => undefined);
  const [orders, batches, writeoffs, users, clients, plans, forecast, settings] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listWriteoffs().catch(() => []),
    listUsers(),
    listClients().catch(() => []),
    getPlansForPeriod(month),
    forecastByWeek(month),
    settingsMap().catch(() => ({}) as Record<string, string>),
  ]);
  const clientCount: Record<string, number> = {};
  for (const c of clients) {
    if (!c.active || (c.retail || "").trim()) continue;
    const email = (c.managerEmail || "").trim().toLowerCase();
    if (email) clientCount[email] = (clientCount[email] ?? 0) + 1;
  }
  const currentPlans: Record<string, number> = {};
  for (const [email, plan] of plans) currentPlans[email] = plan.targetAmount;
  return {
    input: {
      month,
      today,
      scenario,
      orders,
      batches,
      writeoffs,
      managers: users.filter((u) => u.role === ROLES.MANAGER && u.active).map((u) => ({ email: u.email, name: u.name })),
      names: nameIndex(users),
      forecast,
      clientCount,
      currentPlans,
    },
    snapshot: parseSnapshot(settings[aiPlanSettingKey(month)]),
  };
}
