import { chatJson } from "./openai";
import { AI_PLAN_SCHEMA, AI_PLAN_SYSTEM, aiPlanPrompt, parseAiAdvice, type AiAdvice, type AiPlan } from "./aiPlan";
import { flowerPickLabelPlural } from "./constants";

/**
 * Совет модели по готовому расчёту плана (`aiPlan.ts`): множители долей и объяснения. Цифр модель не считает —
 * её ответ проверяется (`parseAiAdvice`) и применяется расчётом заново.
 */
export async function askAiPlanAdvice(plan: AiPlan, comment: string): Promise<{ advice: AiAdvice; model: string }> {
  const { data, model } = await chatJson(AI_PLAN_SYSTEM, aiPlanPrompt(plan, flowerPickLabelPlural, comment), "sales_plan_advice", AI_PLAN_SCHEMA);
  return { advice: parseAiAdvice(data, plan), model };
}
