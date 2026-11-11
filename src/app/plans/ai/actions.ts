"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { localDayKey } from "@/lib/timezone";
import { buildAiPlan, cleanPlanMonth, cleanScenario, parseAiAdvice, weeklySplit, type AiAdvice, type AiPlan, type Qty } from "@/lib/aiPlan";
import { askAiPlanAdvice } from "@/lib/aiPlanAdvisor";
import { PLAN_FLOWERS } from "@/lib/managerPlans";
import { savePlans, type PlanRow } from "@/lib/repo/plans";
import { saveShipmentPlans, type ShipmentPlanInput } from "@/lib/repo/shipmentPlans";
import { saveSettings } from "@/lib/repo/settings";
import { isKnownDirection } from "@/lib/constants";
import { aiPlanSettingKey, loadAiPlanInput, type AiPlanSnapshot } from "./data";

/** План с ИИ — вкладка владельца и Данияра (оба администраторы). Проверка на сервере, а не только в меню. */
async function requireAdmin(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== "admin") throw new Error("План с ИИ ставит администратор");
  return session.user.email.toLowerCase();
}

async function askAiPlanActionInner(monthRaw: string, scenarioRaw: string, comment: string): Promise<{ plan: AiPlan; advice: AiAdvice; model: string }> {
  await requireAdmin();
  const today = localDayKey();
  const month = cleanPlanMonth(monthRaw, today);
  const scenario = cleanScenario(scenarioRaw);
  const { input } = await loadAiPlanInput(month, today, scenario);
  const base = buildAiPlan(input);
  const { advice, model } = await askAiPlanAdvice(base, String(comment || ""));
  return { plan: buildAiPlan({ ...input, advice }), advice, model };
}

export interface AiPlanSavePayload {
  month: string;
  scenario: string;
  comment: string;
  model: string;
  advice: AiAdvice | null;
  /** План на ОСТАВШИЕСЯ дни — как на экране, с правками человека. */
  managers: { email: string; byFlower: Record<string, Qty> }[];
  directions: { direction: string; byFlower: Record<string, Qty> }[];
  saveManagers: boolean;
  saveDirections: boolean;
}

const whole = (v: unknown, what: string, max: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what}: число не может быть отрицательным`);
  if (n > max) throw new Error(`${what}: слишком большое число`);
  return n;
};

async function saveAiPlanActionInner(payload: AiPlanSavePayload): Promise<{ managerRows: number; directionRows: number }> {
  const email = await requireAdmin();
  const today = localDayKey();
  const month = cleanPlanMonth(payload.month, today);
  if (month !== payload.month) throw new Error("План ставится на текущий или следующий месяц — обновите страницу");
  const scenario = cleanScenario(payload.scenario);
  // Факт месяца и список действующих менеджеров берём свои, а не присланные (грабли 1.11).
  const { input } = await loadAiPlanInput(month, today, scenario);
  const fresh = buildAiPlan(input);
  const known = new Map(fresh.managers.filter((m) => !m.virtual).map((m) => [m.email, m]));

  const planRows: PlanRow[] = [];
  const managerTotals: { email: string; sum: number }[] = [];
  if (payload.saveManagers) {
    for (const row of payload.managers ?? []) {
      const key = String(row.email || "").trim().toLowerCase();
      const m = known.get(key);
      if (!m) continue;
      let total = 0;
      for (const f of PLAN_FLOWERS) {
        const left = row.byFlower?.[f];
        const fact = m.factByFlower[f];
        if (!left && !fact) continue;
        const amount = whole((left?.sum ?? 0) + (fact?.sum ?? 0), `${m.name} · ${f}`, 1_000_000_000_000);
        const stems = whole((left?.stems ?? 0) + (fact?.stems ?? 0), `${m.name} · ${f}`, 100_000_000);
        planRows.push({ period: month, managerEmail: key, flowerType: f, targetAmount: amount, targetStems: stems });
        total += amount;
      }
      managerTotals.push({ email: key, sum: total });
    }
    if (!planRows.length) throw new Error("В плане менеджеров нет ни одной строки");
  }

  const shipRows: ShipmentPlanInput[] = [];
  const directionTotals: { direction: string; stems: number }[] = [];
  if (payload.saveDirections) {
    for (const row of payload.directions ?? []) {
      const direction = String(row.direction || "").trim();
      if (!isKnownDirection(direction)) continue;
      let total = 0;
      for (const f of PLAN_FLOWERS) {
        const left = row.byFlower?.[f];
        if (!left) continue;
        const stems = whole(left.stems, `${direction} · ${f}`, 100_000_000);
        const sum = whole(left.sum, `${direction} · ${f}`, 1_000_000_000_000);
        total += stems;
        for (const w of weeklySplit(month, fresh.from, fresh.daysLeft, stems, sum)) {
          shipRows.push({ period: w.week, direction, flowerType: f, targetStems: w.stems, targetAmount: w.sum });
        }
      }
      directionTotals.push({ direction, stems: total });
    }
  }

  if (planRows.length) await savePlans(planRows);
  if (shipRows.length) await saveShipmentPlans(shipRows, email);
  const snapshot: AiPlanSnapshot = {
    at: new Date().toISOString(),
    by: email,
    scenario,
    model: String(payload.model || "").slice(0, 60),
    comment: String(payload.comment || "").slice(0, 600),
    advice: payload.advice ? parseAiAdvice(payload.advice, fresh) : null,
    managers: managerTotals,
    directions: directionTotals,
  };
  await saveSettings({ [aiPlanSettingKey(month)]: JSON.stringify(snapshot) });

  for (const path of ["/plans", "/plans/ai", "/plans/sales", "/plans/shipments", "/plans/balance", "/sales", "/sales/plan", "/analytics/flow"]) revalidatePath(path);
  return { managerRows: planRows.length, directionRows: shipRows.length };
}

export async function askAiPlanAction(...args: Parameters<typeof askAiPlanActionInner>) {
  return guard(() => askAiPlanActionInner(...args));
}
export async function saveAiPlanAction(...args: Parameters<typeof saveAiPlanActionInner>) {
  return guard(() => saveAiPlanActionInner(...args));
}
