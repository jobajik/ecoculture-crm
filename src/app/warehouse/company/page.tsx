import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { listStaffTakeouts } from "@/lib/repo/staffTakeouts";
import { getCurrentPrices } from "@/lib/repo/prices";
import { PRICE_KINDS, priceFromMap, priceMapForClient } from "@/lib/priceList";
import {
  COMPANY_USE_PURPOSES,
  farmLabel,
  getFarmFor,
  periodLabel,
  periodOf,
  periodShift,
} from "@/lib/constants";
import {
  buildCompanyUse,
  canFillTakeouts,
  cleanStaffName,
  isCompanyUse,
  takeoutFarmScope,
} from "@/lib/staffTakeout";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import Section from "@/components/Section";
import { WAREHOUSE_TABS } from "../tabs";
import StaffTakeoutForm, { type TakeoutBatchOption } from "@/components/StaffTakeoutForm";
import CompanyUseReport from "@/components/CompanyUseReport";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Расход на нужды компании — то, что зав. складом называет «админ расход».
 *
 * Подарки, офис, мероприятия, образцы клиентам: цветок уходит со склада
 * бесплатно. Это не продажа (выручки нет), не списание (цветок не пропал, и
 * показатель потерь портить нельзя) и не выдача сотруднику (удерживать не с
 * кого). Без этой страницы такой расход либо не записывали вовсе — и склад
 * расходился с холодильником, — либо записывали списанием, и тогда «потери»
 * росли от подарков.
 *
 * Механика та же, что у выдач сотрудникам (та же вкладка, колонка Kind), —
 * поэтому и форма та же, с другими словами.
 */
export default async function CompanyUsePage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canFillTakeouts(role)) redirect("/?error=forbidden");

  const farm = takeoutFarmScope(role, session?.user?.farm ?? null);
  const today = dayKey(new Date());
  const current = periodOf(new Date());
  const month =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : current;

  const [batches, takeouts, prices] = await Promise.all([
    listBatches(),
    listStaffTakeouts(),
    getCurrentPrices(undefined, PRICE_KINDS.RETAIL),
  ]);

  const priceMap = priceMapForClient(prices);
  const options: TakeoutBatchOption[] = batches
    .filter((b) => b.quantityRemaining > 0)
    // Только основной склад: офис отдаёт цветок клиентам (`officeStore.ts`).
    .filter((b) => !b.store)
    .filter((b) => !farm || getFarmFor(b.flowerType) === farm)
    .map((b) => ({
      batchId: b.batchId,
      flowerType: b.flowerType,
      variety: b.variety,
      grade: b.grade,
      harvestDate: b.harvestDate,
      quantityRemaining: b.quantityRemaining,
      suggestedPrice: priceFromMap(priceMap, b.flowerType, b.variety, b.grade),
    }));

  const data = buildCompanyUse({
    takeouts,
    from: `${month}-01`,
    to: `${month}-31`,
    farm,
  });

  // Подсказки назначения: готовые слова плюс то, что уже вписывали.
  const used = takeouts.filter(isCompanyUse).map((t) => cleanStaffName(t.staffName));
  const purposes = Array.from(new Set([...COMPANY_USE_PURPOSES, ...used])).filter(Boolean);

  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const top = data.byPurpose[0];

  // Новый вид (19.10.2026): цифры месяца сверху, форма слева, расход месяца справа одной карточкой с месяцами-
  // кнопками — вместо формы, ряда ссылок и отчёта лентой.
  return (
    <div>
      <PageHeader
        area="stock"
        title={`Нужды компании${farm ? ` · ${farmLabel(farm)}` : ""}`}
        subtitle="Подарки, офис, мероприятия, образцы."
        icon="tag"
        tabs={WAREHOUSE_TABS}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="leaf" label={`Стеблей за ${periodLabel(month)}`} value={nf(data.stems)} hint={`${data.rows.length} записей`} />
        <KpiTile icon="wallet" label="По внутренней цене" value={`${nf(data.amount)} ₸`} hint="не удерживается" />
        <KpiTile
          icon="tag"
          label="Больше всего"
          value={top ? top.purpose : "—"}
          hint={top ? `${nf(top.stems)} шт.` : "расхода нет"}
        />
        <KpiTile
          icon="alert"
          label="Без цены"
          value={nf(data.noPrice)}
          hint={data.noPrice > 0 ? "не вошли в сумму" : "у всех строк есть цена"}
          tone={data.noPrice > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        <Section tone="stock" icon="tag" title="Записать расход" className="!mb-0 [&_.card]:!shadow-none [&_.card]:!border-0 [&_.card]:!p-0">
          <StaffTakeoutForm batches={options} knownNames={purposes} today={today} defaultDate={today} company />
        </Section>

        <div className="card !p-0 overflow-hidden min-w-0">
          <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
            {months.map((m) => (
              <Link
                key={m}
                href={`/warehouse/company?month=${m}`}
                className={
                  m === month
                    ? "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold"
                    : "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-transparent text-ink-secondary hover:text-ink-primary"
                }
              >
                {periodLabel(m)}
              </Link>
            ))}
          </div>
          {/* Отчёт общий со страницей бухгалтера (`CompanyUseReport`); здесь он внутри карточки. */}
          <div className="p-4 sm:p-5 [&_.card]:!shadow-none">
            <CompanyUseReport data={data} title={periodLabel(month)} />
          </div>
        </div>
      </div>
    </div>
  );
}
