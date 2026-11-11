import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { localDayKey } from "@/lib/timezone";
import { openAiConfigured } from "@/lib/openai";
import { flowerPickLabelPlural, FLOWER_ORDER_ALL } from "@/lib/constants";
import { monthTitle } from "@/lib/monthReport";
import { SCENARIOS, buildAiPlan, cleanPlanMonth, cleanScenario, planMonths } from "@/lib/aiPlan";
import PageHeader from "@/components/PageHeader";
import AiPlanBoard from "@/components/AiPlanBoard";
import { plansTabsFor } from "../tabs";
import { loadAiPlanInput } from "./data";

export const dynamic = "force-dynamic";
// Совет ИИ — серверное действие этой страницы: модель думает до 50 секунд.
export const maxDuration = 60;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * «Планы → План с ИИ» (11.11.2026, владелец: «распределить план продаж по менеджерам, регионам и другим каналам через
 * ИИ… чтобы эта вкладка была у меня и Данияра»). Страница сразу показывает раскладку программы (`buildAiPlan`): хватит
 * ли цветка, сколько ставить менеджерам, каналам и направлениям. Кнопка «Спросить ИИ» добавляет совет модели, правки
 * человека — в полях, запись в «Планы продаж» и «План отгрузок» — только по кнопке. Видят администраторы.
 */
export default async function AiPlanPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (role !== "admin") redirect("/plans");

  const today = localDayKey();
  const month = cleanPlanMonth(one(searchParams.month), today);
  const scenario = cleanScenario(one(searchParams.scenario));
  const { input, snapshot } = await loadAiPlanInput(month, today, scenario);
  const plan = buildAiPlan(input);

  const q = (patch: Record<string, string>) => {
    const next = { month, scenario, ...patch };
    return `/plans/ai?month=${next.month}&scenario=${next.scenario}`;
  };
  const pill = (active: boolean) => `flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent-soft text-accent" : "bg-surface-plane text-ink-secondary hover:text-ink-primary"}`;
  const ROW = "flex items-center gap-2 min-w-0 max-w-full overflow-x-auto scroll-x-hidden sm:flex-wrap sm:overflow-visible";
  const current = SCENARIOS.find((s) => s.code === scenario)!;

  return (
    <div>
      <PageHeader
        area="plans"
        title="План с ИИ"
        subtitle="Сколько ставить менеджерам, каналам и направлениям — по истории продаж, складу и срезке"
        tabs={plansTabsFor(role, month)}
      />
      <div className="card p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className={ROW}>
            {planMonths(today).map((m) => (
              <Link key={m} href={q({ month: m })} className={pill(m === month)}>
                {monthTitle(m)}
              </Link>
            ))}
          </div>
          <div className={ROW}>
            {SCENARIOS.map((s) => (
              <Link key={s.code} href={q({ scenario: s.code })} className={pill(s.code === scenario)} title={s.hint}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        <p className="text-[13px] text-ink-secondary">
          {current.label}: {current.hint}.{" "}
          {plan.isCurrent ? `План считается на оставшиеся ${plan.daysLeft} дн. месяца; уже проданное прибавляется к нему.` : "Месяц ещё не начался — план на весь месяц; склад на его начало неизвестен, считается только срезка."}
        </p>
      </div>
      <AiPlanBoard
        key={`${month}:${scenario}`}
        plan={plan}
        snapshot={snapshot}
        flowerLabels={Object.fromEntries(FLOWER_ORDER_ALL.map((f) => [f, flowerPickLabelPlural(f)]))}
        monthLabel={monthTitle(month)}
        aiReady={openAiConfigured()}
      />
    </div>
  );
}
