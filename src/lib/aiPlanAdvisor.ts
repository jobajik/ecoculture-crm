import { chatJson } from "./openai";
import { AI_PLAN_SCHEMA, AI_PLAN_SYSTEM, aiPlanPrompt, parseAiAdvice, type AiAdvice, type AiPlan } from "./aiPlan";
import { flowerPickLabelPlural } from "./constants";

/**
 * Совет модели по готовому расчёту плана (`aiPlan.ts`): множители долей и объяснения. Цифр модель не считает —
 * её ответ проверяется (`parseAiAdvice`) и применяется расчётом заново.
 */
export async function askAiPlanAdvice(plan: AiPlan, comment: string): Promise<{ advice: AiAdvice; model: string }> {
  // Быстрая модель (gpt-4.1): на живых данных gpt-5-mini думала дольше 50 секунд, а действие на сайте живёт минуту.
  try {
    const { data, model } = await chatJson(AI_PLAN_SYSTEM, aiPlanPrompt(plan, flowerPickLabelPlural, comment), "sales_plan_advice", AI_PLAN_SCHEMA, { fast: true, timeoutMs: 45_000 });
    return { advice: parseAiAdvice(data, plan), model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(message)) throw new Error("ИИ не успел ответить за 45 секунд — нажмите «Спросить ИИ» ещё раз. Раскладка программы от этого не зависит.");
    throw err;
  }
}
