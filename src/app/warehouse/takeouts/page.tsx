import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { listStaffTakeouts } from "@/lib/repo/staffTakeouts";
import { getCurrentPrices } from "@/lib/repo/prices";
import { PRICE_KINDS, priceFromMap, priceMapForClient } from "@/lib/priceList";
import {
  FLOWER_TYPE_LABELS,
  farmLabel,
  formatGrade,
  getFarmFor,
  periodLabel,
  periodOf,
} from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import {
  buildStaffMonth,
  buildTakeoutDay,
  canFillTakeouts,
  canSeeTakeouts,
  knownStaffNames,
  takeoutFarmScope,
} from "@/lib/staffTakeout";
import SectionTabs from "@/components/SectionTabs";
import { WAREHOUSE_TABS } from "../tabs";
import DayNav from "@/components/DayNav";
import StaffTakeoutForm, { type TakeoutBatchOption } from "@/components/StaffTakeoutForm";
import StaffTakeoutMonth from "@/components/StaffTakeoutMonth";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Выдачи цветка сотрудникам в счёт зарплаты.
 *
 * Страница отвечает на два вопроса и делит их пополам. Сверху — «кто сегодня
 * что взял»: форма записи и таблица за день. Снизу — «сколько с кого удержать»:
 * итог за месяц по людям.
 *
 * Открывается на СЕГОДНЯ, а не на завтра: выдачу записывают следом за тем, как
 * отдали цветок из рук в руки, а иногда и назавтра за вчера. Поэтому и
 * переключатель дня смотрит назад, а не вперёд, как у розницы.
 *
 * Зав. складом видит только своё производство — то же правило, что на приёмке,
 * отгрузке и в партиях (грабли 1.1-ter). Администратор видит оба.
 */
export default async function StaffTakeoutsPage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeTakeouts(role)) redirect("/?error=forbidden");

  const farm = takeoutFarmScope(role, session?.user?.farm ?? null);
  const today = dayKey(new Date());
  const date =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;

  const [batches, takeouts, prices] = await Promise.all([
    listBatches(),
    listStaffTakeouts(),
    // Внутренний прайс — тот же, по которому цветок уходит в наши магазины.
    // Здесь он только подсказка: цену вписывает зав. складом.
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

  const day = buildTakeoutDay({ takeouts, date, farm });
  const month = buildStaffMonth({ takeouts, month: periodOf(new Date(`${date}T00:00:00`)), farm });
  // Подсказка фамилий — по тем же выдачам, что видит этот человек: зав. складом
  // Есентая незачем предлагать сотрудников чужой теплицы.
  const known = knownStaffNames(
    takeouts.filter((t) => !farm || getFarmFor(t.flowerType) === farm)
  );

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const canFill = canFillTakeouts(role);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">
        Выдачи сотрудникам{farm ? ` · ${farmLabel(farm)}` : ""}
      </h1>
      <p className="text-ink-secondary mb-3">
        Цветы, которые сотрудник взял в счёт зарплаты. Стебли уходят со склада, денег в кассу не
        приходит — сумма идёт бухгалтеру на удержание.
      </p>

      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>

      {canFill && (
        <div className="mb-6">
          <h2 className="font-medium mb-2">Записать выдачу</h2>
          <StaffTakeoutForm
            batches={options}
            knownNames={known}
            today={today}
            defaultDate={date > today ? today : date}
          />
        </div>
      )}

      <h2 className="font-medium mb-2">За день</h2>
      <div className="mb-3">
        <DayNav date={date} today={today} basePath="/warehouse/takeouts" direction="back" />
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Tile title="Стеблей за день" value={nf(day.stems)} hint={formatDay(date)} />
        <Tile title="Человек" value={String(day.people)} hint="брали цветок в этот день" />
        <Tile
          title="На сумму"
          value={`${nf(day.amount)} ₸`}
          hint={day.noPrice > 0 ? `${day.noPrice} ${rowWord(day.noPrice)} без цены` : "это не выручка"}
          warn={day.noPrice > 0}
        />
      </div>

      <div className="card !p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[620px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">Кому</th>
              <th className="px-3 py-2.5 font-medium">Что взял</th>
              <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
              <th className="px-3 py-2.5 font-medium text-right">Цена</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium">Примечание</th>
            </tr>
          </thead>
          <tbody>
            {day.rows.map((r) => (
              <tr key={r.takeoutId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.staffName}</td>
                <td className="px-3 py-2.5 text-ink-secondary">
                  {FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType} {r.variety} ·{" "}
                  {formatGrade(r.grade)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{nf(r.quantity)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                  {r.unitPrice > 0 ? `${nf(r.unitPrice)} ₸` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.unitPrice > 0 ? (
                    `${nf(r.amount)} ₸`
                  ) : (
                    <span className="text-[#8a5a00]">без цены</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ink-muted">{r.note || "—"}</td>
              </tr>
            ))}
            {day.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                  На {formatDay(date)} выдач нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StaffTakeoutMonth
        month={month}
        title={`Итог за ${periodLabel(periodOf(new Date(`${date}T00:00:00`)))}`}
        hint="Это сумма к удержанию из зарплаты"
      />
    </div>
  );
}

function Tile({
  title,
  value,
  hint,
  warn,
}: {
  title: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-sm text-ink-secondary">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className={`text-xs mt-1 ${warn ? "text-[#8a5a00]" : "text-ink-muted"}`}>{hint}</div>
    </div>
  );
}

/** Русское склонение: 1 строка, 2 строки, 5 строк. */
function rowWord(n: number): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "строк";
  if (o === 1) return "строка";
  if (o > 1 && o < 5) return "строки";
  return "строк";
}
