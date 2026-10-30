"use server";

import { guard } from "@/lib/actionResult";
import { FARM_LABELS } from "@/lib/constants";
import { buildDashboard, buildReport, dataDigest, harvestByMonth } from "@/lib/greenhouse/dashboard";
import { cachedAccuracy, greenhouseForecast, loadGreenhousePlan } from "@/lib/greenhouse/dashboardData";
import { lossByMonth } from "@/lib/greenhouse/insights";
import { summarizeCycles } from "@/lib/greenhouse/production";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { chatJson } from "@/lib/openai";
import { loadGreenhouse } from "@/lib/repo/greenhouse";
import { shiftDay } from "@/lib/payroll/work";
import { localDayKey } from "@/lib/timezone";

/**
 * «Спросить по данным» на обзоре теплицы (30.10.2026, ТЗ владельца: «AI должен использовать реальные данные системы,
 * а не придумывать показатели»). Модель получает ТОЛЬКО выжимку настоящих цифр (`dataDigest`) и отвечает из неё;
 * чего в выжимке нет — так и говорит. Сами цифры считает программа, модель только находит нужные и объясняет словами.
 */

const SYSTEM = `Ты — помощник руководителя тепличного хозяйства (хризантема). Тебе дают СВОДКУ настоящих данных теплицы и вопрос.
Правила:
- Отвечай только из сводки. Не придумывай цифр, которых в ней нет, и не делай вид, что знаешь больше.
- Можно сложить, сравнить, посчитать долю из чисел сводки — тогда покажи, из чего посчитано.
- Если в сводке нет данных для ответа — прямо скажи, чего не хватает (например: «по сотрудникам здесь данных нет»), и что можно посмотреть в разделе.
- Пиши по-русски, просто, коротко: 2–6 предложений или короткий список. Числа — с пробелами тысяч. Без воды и без «отличный вопрос».
- Прогноз — это ожидание, называй его «≈» и упоминай, насколько он обычно ошибается, если это есть в сводке.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

async function askGreenhouseActionInner(farm: string, question: string): Promise<{ answer: string }> {
  const { scope, farm: f } = await greenhouseSession({ farm });
  if (!scope) throw new Error("Раздел «Теплица» для вас закрыт.");
  const q = String(question ?? "").trim().slice(0, 400);
  if (q.length < 3) throw new Error("Напишите вопрос.");
  const today = localDayKey();
  const [data, plan] = await Promise.all([loadGreenhouse(f), loadGreenhousePlan(f)]);
  if (!data.harvest.length && !data.cycles.length) return { answer: "Данных по теплице пока нет — загрузите книгу агронома или внесите первый день." };
  const rows = summarizeCycles(data, today);
  const dash = buildDashboard(data, rows, plan, today);
  const forecast = greenhouseForecast(rows, data, today);
  const digest = dataDigest({
    farmLabel: FARM_LABELS[f] ?? f,
    dash,
    rows,
    report30: buildReport(data, plan, shiftDay(today, -29), today),
    forecast,
    accuracy: cachedAccuracy(f, data, today),
    monthsLoss: lossByMonth(data, today, 12),
    monthsHarvest: harvestByMonth(data.harvest, today, 12),
  });
  const { data: out } = await chatJson(SYSTEM, `СВОДКА ДАННЫХ:\n${digest}\n\nВОПРОС: ${q}`, "greenhouse_answer", SCHEMA);
  const answer = String((out as { answer?: unknown })?.answer ?? "").trim();
  if (!answer) throw new Error("ИИ не ответил — попробуйте ещё раз.");
  return { answer };
}

export async function askGreenhouseAction(farm: string, question: string) {
  return guard(() => askGreenhouseActionInner(farm, question));
}
