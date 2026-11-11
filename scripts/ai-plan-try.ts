import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * «План с ИИ» на живых данных без браузера и БЕЗ записи: расчёт программы, совет модели и раскладка после совета.
 *
 *   npx tsx scripts/ai-plan-try.ts [месяц ГГГГ-ММ] [careful|base|ambitious] [--no-ai] [--prompt]
 */
import { localDayKey } from "../src/lib/timezone";
import { aiPlanPrompt, buildAiPlan, cleanPlanMonth, cleanScenario, type AiPlan } from "../src/lib/aiPlan";
import { askAiPlanAdvice } from "../src/lib/aiPlanAdvisor";
import { flowerPickLabelPlural } from "../src/lib/constants";
import { loadAiPlanInput } from "../src/app/plans/ai/data";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

function print(plan: AiPlan, title: string) {
  console.log(`\n=== ${title}: ${plan.month}, ${plan.scenario}, осталось ${plan.daysLeft} дн. из ${plan.daysTotal} ===`);
  console.log(`История: ${plan.periods.map((p) => `${p.label} (${p.days} дн., вес ${Math.round(p.weight * 100)}%)`).join("; ")}`);
  for (const f of plan.flowers) console.log(`${flowerPickLabelPlural(f.flowerType).padEnd(24)} склад ${nf(f.stock).padStart(8)} срежем ${nf(f.forecastLeft).padStart(8)} (${f.forecastSource}) спис ${Math.round(f.writeoffShare * 100)}% можно ${nf(f.sellable).padStart(8)} обычно ${nf(f.demandLeft).padStart(8)} план ${nf(f.targetLeft).padStart(8)} останется ${nf(f.gap).padStart(8)} цена ${nf(f.price)}`);
  console.log("Каналы:");
  for (const c of plan.channels) console.log(`  ${c.label.padEnd(20)} история ${c.history.map(nf).join(" / ")} · уже ${nf(c.fact.stems)} · план ${nf(c.target.stems)} шт. ${nf(c.target.sum)} ₸${c.reason ? ` · ${c.reason}` : ""}`);
  console.log(`Менеджеры (уже продано ${nf(plan.clientsFact)} ₸, план месяца ${nf(plan.clientsMonth)} ₸):`);
  for (const m of plan.managers) console.log(`  ${m.name.padEnd(16)} история ${m.history.map(nf).join(" / ")} · уже ${nf(m.fact.sum)} · остаток ${nf(m.target.sum)} · месяц ${nf(m.month.sum)} · в день ${nf(m.perDay)} · клиентов ${m.clients} · в CRM ${nf(m.current)}${m.reason ? ` · ${m.reason}` : ""}`);
  console.log("Направления:");
  for (const d of plan.directions) console.log(`  ${d.direction.padEnd(18)} история ${d.history.map(nf).join(" / ")} · уже ${nf(d.fact)} · план ${nf(d.target.stems)}${d.reason ? ` · ${d.reason}` : ""}`);
  for (const n of plan.notes) console.log(`• ${n}`);
}

async function main() {
  const args = process.argv.slice(2);
  const today = localDayKey();
  const month = cleanPlanMonth(args.find((a) => /^\d{4}-\d{2}$/.test(a)), today);
  const scenario = cleanScenario(args.find((a) => ["careful", "base", "ambitious"].includes(a)));
  const { input } = await loadAiPlanInput(month, today, scenario);
  const base = buildAiPlan(input);
  print(base, "Расчёт программы");
  if (args.includes("--prompt")) console.log(`\n--- что уходит модели ---\n${aiPlanPrompt(base, flowerPickLabelPlural, "")}`);
  if (args.includes("--no-ai")) return;
  const started = Date.now();
  const { advice, model } = await askAiPlanAdvice(base, "");
  console.log(`\n=== Совет ИИ (${model}, ${Math.round((Date.now() - started) / 1000)} с) ===\n${advice.summary}`);
  for (const a of advice.actions) console.log(`→ ${a}`);
  for (const r of advice.risks) console.log(`! ${r}`);
  console.log(`множители: менеджеры ${advice.managers.map((m) => `${m.email.split("@")[0]} ×${m.factor}`).join(", ")}; каналы ${advice.channels.map((c) => `${c.channel} ×${c.factor}`).join(", ")}; направления ${advice.directions.map((d) => `${d.direction} ×${d.factor}`).join(", ")}`);
  print(buildAiPlan({ ...input, advice }), "После совета ИИ");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
