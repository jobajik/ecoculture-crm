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
  unpricedTakeouts,
} from "@/lib/staffTakeout";
import Link from "next/link";
import TakeoutPriceCell from "@/components/TakeoutPriceCell";
import KpiTile from "@/components/KpiTile";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
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
  searchParams?: { date?: string; tab?: string };
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

  const day = buildTakeoutDay({ takeouts, date, farm });
  const monthKey = periodOf(new Date(`${date}T00:00:00`));
  const month = buildStaffMonth({ takeouts, month: monthKey, farm });
  // Выдачи без цены — их сумма не удерживается; цену ставят здесь же.
  const unpriced = unpricedTakeouts({ takeouts, month: monthKey, farm });
  const suggestedFor = (t: { flowerType: string; variety: string; grade: string }) =>
    priceFromMap(priceMap, t.flowerType, t.variety, t.grade);
  // Подсказка фамилий — по тем же выдачам, что видит этот человек: зав. складом
  // Есентая незачем предлагать сотрудников чужой теплицы.
  const known = knownStaffNames(
    takeouts.filter((t) => !farm || getFarmFor(t.flowerType) === farm)
  );

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const canFill = canFillTakeouts(role);

  // Вкладки карточки справа (новый вид, 19.10.2026): «за день», «без цены» и «итог месяца» — одна карточка,
  // а не три блока лентой. Вкладка живёт в адресе, день переносится между вкладками.
  const tab = searchParams?.tab === "month" ? "month" : searchParams?.tab === "unpriced" && canFill && unpriced.length > 0 ? "unpriced" : "day";
  const tabHref = (t: string) => {
    const q = new URLSearchParams();
    if (searchParams?.date) q.set("date", date);
    if (t !== "day") q.set("tab", t);
    const qs = q.toString();
    return `/warehouse/takeouts${qs ? `?${qs}` : ""}`;
  };
  const tabs: { key: string; label: string; n?: number; alarm?: boolean }[] = [
    { key: "day", label: `За ${date === today ? "сегодня" : formatDay(date)}`, n: day.rows.length },
    ...(canFill && unpriced.length > 0 ? [{ key: "unpriced", label: "Без цены", n: unpriced.length, alarm: true }] : []),
    { key: "month", label: `Итог за ${periodLabel(monthKey)}` },
  ];

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Выдачи сотрудникам${farm ? ` · ${farmLabel(farm)}` : ""}`}
        subtitle="В счёт зарплаты."
        icon="client"
        tabs={WAREHOUSE_TABS}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="leaf" label="Стеблей за день" value={nf(day.stems)} hint={formatDay(date)} />
        <KpiTile icon="client" label="Человек за день" value={String(day.people)} />
        <KpiTile
          icon="wallet"
          label="На сумму за день"
          value={`${nf(day.amount)} ₸`}
          hint={day.noPrice > 0 ? `${day.noPrice} ${rowWord(day.noPrice)} без цены` : undefined}
          tone={day.noPrice > 0 ? "warn" : undefined}
        />
        <KpiTile
          icon="calendar"
          label={`К удержанию за ${periodLabel(monthKey)}`}
          value={`${nf(month.amount)} ₸`}
          hint={`${month.people} чел. · ${nf(month.stems)} шт.`}
          href={tabHref("month")}
        />
      </div>

      <div className={canFill ? "grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start" : ""}>
        {canFill && (
          <Section tone="stock" icon="client" title="Записать выдачу" className="!mb-0 [&_.card]:!shadow-none [&_.card]:!border-0 [&_.card]:!p-0">
            <StaffTakeoutForm
              batches={options}
              knownNames={known}
              today={today}
              defaultDate={date > today ? today : date}
            />
          </Section>
        )}

        <div className="card !p-0 overflow-hidden min-w-0">
          <div className="flex flex-wrap gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                className={
                  tab === t.key
                    ? "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold"
                    : "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-transparent text-ink-secondary hover:text-ink-primary"
                }
              >
                {t.label}
                {t.n !== undefined && (
                  <span className={t.alarm ? " tabular-nums text-status-critical font-semibold" : " tabular-nums text-ink-muted"}> {t.n}</span>
                )}
              </Link>
            ))}
          </div>

          {tab === "day" && (
            <>
              <div className="px-4 py-3 border-b border-line-hairline">
                <DayNav date={date} today={today} basePath="/warehouse/takeouts" direction="back" />
              </div>
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
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
                      <tr key={r.takeoutId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                        <td data-label="Кому" className="px-4 py-2.5 font-medium whitespace-nowrap">{r.staffName}</td>
                        <td data-label="Что взял" className="px-3 py-2.5 text-ink-secondary">
                          {FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType} {r.variety} · {formatGrade(r.grade)}
                        </td>
                        <td data-label="Стеблей" className="px-3 py-2.5 text-right tabular-nums">{nf(r.quantity)}</td>
                        <td data-label="Цена" className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                          {canFill ? (
                            <TakeoutPriceCell takeoutId={r.takeoutId} unitPrice={r.unitPrice} suggested={suggestedFor(r)} />
                          ) : r.unitPrice > 0 ? (
                            `${nf(r.unitPrice)} ₸`
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-label="Сумма" className="px-3 py-2.5 text-right tabular-nums">
                          {r.unitPrice > 0 ? `${nf(r.amount)} ₸` : <span className="text-[#8a5a00]">без цены</span>}
                        </td>
                        <td data-label="Примечание" className="px-3 py-2.5 text-ink-muted">{r.note || "—"}</td>
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
            </>
          )}

          {tab === "unpriced" && (
            <>
              <p className="text-sm text-ink-secondary px-4 sm:px-5 py-3 border-b border-line-hairline">
                Без цены не попадут в удержание.
              </p>
              <div className="table-scroll table-cards">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                      <th className="px-4 py-2.5 font-medium">Кому</th>
                      <th className="px-3 py-2.5 font-medium">Дата</th>
                      <th className="px-3 py-2.5 font-medium">Что взял</th>
                      <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
                      <th className="px-3 py-2.5 font-medium text-right">Цена, ₸</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpriced.map((t) => (
                      <tr key={t.takeoutId} className="border-b border-line-hairline last:border-0">
                        <td className="px-4 py-2.5 font-medium">{t.staffName}</td>
                        <td data-label="Дата" className="px-3 py-2.5 text-ink-secondary whitespace-nowrap">
                          {formatDay(t.date)}
                        </td>
                        <td data-label="Что взял" className="px-3 py-2.5 text-ink-secondary">
                          {FLOWER_TYPE_LABELS[t.flowerType] ?? t.flowerType} {t.variety} · {formatGrade(t.grade)}
                        </td>
                        <td data-label="Стеблей" className="px-3 py-2.5 text-right tabular-nums">{nf(t.quantity)}</td>
                        <td data-label="Цена, ₸" className="px-3 py-2.5 text-right">
                          <TakeoutPriceCell takeoutId={t.takeoutId} unitPrice={0} suggested={suggestedFor(t)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "month" && (
            // Таблица месяца — общая со страницей бухгалтера (`StaffTakeoutMonth`); здесь она внутри карточки.
            <div className="p-4 sm:p-5 [&_.card]:!shadow-none">
              <StaffTakeoutMonth month={month} title={`Итог за ${periodLabel(monthKey)}`} hint="К удержанию из зарплаты" />
            </div>
          )}
        </div>
      </div>
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
