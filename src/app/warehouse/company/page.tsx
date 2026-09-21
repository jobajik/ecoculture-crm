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
import SectionTabs from "@/components/SectionTabs";
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

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">
        Нужды компании{farm ? ` · ${farmLabel(farm)}` : ""}
      </h1>
      <p className="text-ink-secondary mb-3">
        Админ. расход: подарки, офис, мероприятия, образцы клиентам. Стебли уходят со склада
        бесплатно — это не продажа, не списание и не выдача в счёт зарплаты.
      </p>

      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>

      <div className="mb-6">
        <h2 className="font-medium mb-2">Записать расход</h2>
        <StaffTakeoutForm
          batches={options}
          knownNames={purposes}
          today={today}
          defaultDate={today}
          company
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {months.map((m) => (
          <Link
            key={m}
            href={`/warehouse/company?month=${m}`}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
              (m === month
                ? "border-accent bg-accent-soft text-ink-primary font-medium"
                : "border-line-hairline text-ink-secondary hover:text-ink-primary")
            }
          >
            {periodLabel(m)}
          </Link>
        ))}
      </div>

      <CompanyUseReport data={data} title={`${periodLabel(month)} — на нужды компании`} />
    </div>
  );
}
