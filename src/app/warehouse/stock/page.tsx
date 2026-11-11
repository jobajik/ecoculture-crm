import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { MISSING_FARM_MESSAGE, missingFarm } from "@/lib/access";
import { farmLabel, flowerPickLabelPlural, formatGrade, isChrysanthemum } from "@/lib/constants";
import { STORE_LABELS, type StoreCode } from "@/lib/officeStore";
import { localDayKey } from "@/lib/timezone";
import { EARLIER, NO_DATE, buildStockMatrix, daysAgo, type FlowerMatrix } from "@/lib/stockMatrix";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

const TD = "px-2.5 sm:px-3 py-2";
const TDN = "px-2 sm:px-2.5 py-2 text-right tabular-nums whitespace-nowrap";
const TH = "px-2.5 sm:px-3 py-2 font-medium text-left";
const THN = "px-2 sm:px-2.5 py-2 font-medium text-right whitespace-nowrap";
const TROW = "border-b border-line-hairline last:border-0";
const TTOT = "border-t border-line-hairline bg-surface-plane/60 font-semibold";
const THEAD = "border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted";
const ROW = "flex items-center gap-2 min-w-0 max-w-full overflow-x-auto scroll-x-hidden sm:flex-wrap sm:overflow-visible";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** «11.11» — год в шапке колонки не нужен. */
const short = (day: string) => (DAY.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : day);
const ageWord = (n: number) => (n === 0 ? "сегодня" : n === 1 ? "вчера" : `${n} дн.`);

const STORES: { code: string; store: StoreCode | "all"; label: string }[] = [
  { code: "", store: "", label: STORE_LABELS[""] },
  { code: "office", store: "office", label: STORE_LABELS.office },
  { code: "astana", store: "astana", label: STORE_LABELS.astana },
  { code: "all", store: "all", label: "Все склады" },
];

/**
 * «Сорта и ростовки на складе» (12.11.2026, владелец: «срочно — какие сорта и ростовки по складу; видеть розы,
 * эустомы и хризантему по сортам, по дате»). Два вида одной страницы: «По ростовкам» (сорт × длина / категория) и
 * «По датам срезки» (сорт и ростовка × день срезки). Сверху — склад, цветок и день срезки. Расчёт —
 * `buildStockMatrix` (`src/lib/stockMatrix.ts`); зав. складом видит только свой цветок и основной склад.
 */
export default async function StockMatrixPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const ownFarm = role === "warehouse" ? session?.user?.farm ?? null : null;
  const tabs = role === "admin" || role === "warehouse" ? WAREHOUSE_TABS : undefined;

  if (missingFarm(role, session?.user?.farm)) {
    return (
      <div>
        <PageHeader area="stock" title="Сорта и ростовки на складе" tabs={tabs} />
        <div className="card p-4 text-sm text-ink-secondary">{MISSING_FARM_MESSAGE}</div>
      </div>
    );
  }

  const today = localDayKey();
  const view = one(searchParams.view) === "dates" ? "dates" : "";
  const storeCode = role === "warehouse" ? "" : STORES.some((s) => s.code === one(searchParams.store)) ? one(searchParams.store) : "";
  const store = STORES.find((s) => s.code === storeCode)!.store;
  const date = DAY.test(one(searchParams.date)) ? one(searchParams.date) : "";
  const from = date || (DAY.test(one(searchParams.from)) ? one(searchParams.from) : "");
  const to = date || (DAY.test(one(searchParams.to)) ? one(searchParams.to) : "");
  const flower = one(searchParams.flower);

  const batches = await listBatches();
  const m = buildStockMatrix({ batches, today, farm: ownFarm, store, from, to });
  const flowerCodes = m.flowers.map((f) => f.flowerType);
  const shown = flower && flowerCodes.includes(flower) ? m.flowers.filter((f) => f.flowerType === flower) : m.flowers;

  const q = (patch: Record<string, string>) => {
    const next: Record<string, string> = { view, store: storeCode, flower, date, from: date ? "" : from, to: date ? "" : to, ...patch };
    const s = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `/warehouse/stock${s ? `?${s}` : ""}`;
  };
  const pill = (active: boolean) => `flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent-soft text-accent" : "bg-surface-plane text-ink-secondary hover:text-ink-primary"}`;
  const anyDate = !from && !to;
  const dayChips = m.dates.filter((d) => d.date).slice(0, 8);
  const periodNote = date
    ? `срезка ${short(date)}`
    : from || to
      ? `срезка ${from ? `с ${short(from)}` : ""}${to ? ` по ${short(to)}` : ""}`
      : "вся срезка, что лежит на складе";

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Сорта и ростовки на складе${ownFarm ? ` · ${farmLabel(ownFarm)}` : ""}`}
        tabs={tabs}
      />

      <div className="card p-3 sm:p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className={ROW}>
            <Link href={q({ view: "" })} className={pill(view === "")}>
              По ростовкам
            </Link>
            <Link href={q({ view: "dates" })} className={pill(view === "dates")}>
              По датам срезки
            </Link>
          </div>
          {role !== "warehouse" && (
            <div className={ROW}>
              {STORES.map((s) => (
                <Link key={s.code} href={q({ store: s.code })} className={pill(s.code === storeCode)}>
                  {s.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        {flowerCodes.length > 1 && (
          <div className={ROW}>
            <Link href={q({ flower: "" })} className={pill(!flower || !flowerCodes.includes(flower))}>
              Все цветы
            </Link>
            {m.flowers.map((f) => (
              <Link key={f.flowerType} href={q({ flower: f.flowerType })} className={pill(f.flowerType === flower)}>
                {flowerPickLabelPlural(f.flowerType)} · {nf(f.total)}
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className={ROW}>
            <span className="flex-none text-xs text-ink-muted">Срезка:</span>
            <Link href={q({ date: "", from: "", to: "" })} className={pill(anyDate)}>
              Все дни
            </Link>
            {dayChips.map((d) => (
              <Link key={d.date} href={q({ date: d.date, from: "", to: "" })} className={pill(date === d.date)} title={`${nf(d.quantity)} шт. · ${ageWord(daysAgo(d.date, today))}`}>
                {short(d.date)}
              </Link>
            ))}
          </div>
          <form action="/warehouse/stock" className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto sm:ml-auto">
            {view && <input type="hidden" name="view" value={view} />}
            {storeCode && <input type="hidden" name="store" value={storeCode} />}
            {flower && <input type="hidden" name="flower" value={flower} />}
            <input type="date" name="from" defaultValue={from} max={today} className="input !py-1.5 !px-2 sm:!px-3 text-[13px] sm:text-sm flex-1 min-w-0 sm:flex-none sm:!w-auto" aria-label="Срезка с" />
            <span className="text-ink-muted">—</span>
            <input type="date" name="to" defaultValue={to} max={today} className="input !py-1.5 !px-2 sm:!px-3 text-[13px] sm:text-sm flex-1 min-w-0 sm:flex-none sm:!w-auto" aria-label="Срезка по" />
            <button className="btn-secondary !py-1.5 flex-none" type="submit">
              <span className="sm:hidden">ОК</span>
              <span className="hidden sm:inline">Показать</span>
            </button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <KpiTile icon="box" label="На складе" value={nf(shown.reduce((s, f) => s + f.total, 0))} hint={`шт. · ${periodNote}`} />
        <KpiTile icon="list" label="Сортов" value={nf(shown.reduce((s, f) => s + f.rows.length, 0))} hint={shown.length > 1 ? `в ${shown.length} цветках` : "с остатком"} />
        {shown.slice(0, 2).map((f) => (
          <KpiTile key={f.flowerType} label={flowerPickLabelPlural(f.flowerType)} value={nf(f.total)} hint={`шт. · ${f.rows.length} сорт.`} />
        ))}
      </div>

      {!shown.length && (
        <div className="card p-4 text-sm text-ink-secondary">
          {anyDate ? "На этом складе сейчас пусто." : "Со срезкой за выбранные дни на складе ничего нет — выберите «Все дни»."}
        </div>
      )}

      <div className="space-y-4">
        {shown.map((f) => (
          <section key={f.flowerType} className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 sm:px-4 py-3 border-b border-line-hairline">
              <h2 className="text-[15px] font-semibold text-ink-primary">{flowerPickLabelPlural(f.flowerType)}</h2>
              <span className="text-[13px] text-ink-secondary tabular-nums">
                {nf(f.total)} шт. · {f.rows.length} сорт.
              </span>
            </div>
            {view === "dates" ? <ByDates f={f} today={today} /> : <ByGrades f={f} today={today} />}
          </section>
        ))}
      </div>
    </div>
  );
}

const cell = (n: number | undefined) => (n ? nf(n) : <span className="text-ink-muted/60">·</span>);

/** Сорт × ростовка (у хризантемы — категория). */
function ByGrades({ f, today }: { f: FlowerMatrix; today: string }) {
  const word = isChrysanthemum(f.flowerType) ? "Категория" : "Ростовка";
  return (
    <div className="table-scroll">
      <table className="w-full text-[13px]" style={{ minWidth: 260 + f.grades.length * 74 }}>
        <thead>
          <tr className={THEAD}>
            <th className={TH}>Сорт</th>
            <th className={THN}>Всего</th>
            {f.grades.map((g) => (
              <th key={g} className={THN} title={word}>
                {formatGrade(g)}
              </th>
            ))}
            <th className={THN}>Срезка</th>
          </tr>
        </thead>
        <tbody>
          {f.rows.map((r) => (
            <tr key={r.variety} className={TROW}>
              <td className={`${TD} font-medium text-ink-primary`}>{r.variety}</td>
              <td className={`${TDN} font-semibold`}>{nf(r.total)}</td>
              {f.grades.map((g) => (
                <td key={g} className={TDN}>
                  {cell(r.byGrade[g])}
                </td>
              ))}
              <td className={`${TDN} text-ink-secondary`}>
                {!r.newest ? "—" : r.oldest === r.newest ? short(r.newest) : `${short(r.oldest)} – ${short(r.newest)}`}
                {r.oldest && <span className="text-ink-muted"> · {ageWord(daysAgo(r.oldest, today))}</span>}
              </td>
            </tr>
          ))}
          <tr className={TTOT}>
            <td className={TD}>Итого</td>
            <td className={TDN}>{nf(f.total)}</td>
            {f.grades.map((g) => (
              <td key={g} className={TDN}>
                {nf(f.gradeTotals[g] ?? 0)}
              </td>
            ))}
            <td className={TDN} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Сорт и ростовка × день срезки: свежие дни слева, старше — в колонке «раньше». */
function ByDates({ f, today }: { f: FlowerMatrix; today: string }) {
  const head = (d: string) => (d === EARLIER ? "раньше" : d === NO_DATE ? "без даты" : short(d));
  return (
    <div className="table-scroll">
      <table className="w-full text-[13px]" style={{ minWidth: 300 + f.dates.length * 70 }}>
        <thead>
          <tr className={THEAD}>
            <th className={TH}>Сорт · {isChrysanthemum(f.flowerType) ? "категория" : "ростовка"}</th>
            <th className={THN}>Всего</th>
            {f.dates.map((d) => (
              <th key={d} className={THN}>
                {head(d)}
                {DAY.test(d) && <div className="font-normal text-[11px] text-ink-muted">{ageWord(daysAgo(d, today))}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {f.rows.map((r) => (
            <FragmentRows key={r.variety} f={f} r={r} />
          ))}
          <tr className={TTOT}>
            <td className={TD}>Итого</td>
            <td className={TDN}>{nf(f.total)}</td>
            {f.dates.map((d) => (
              <td key={d} className={TDN}>
                {nf(f.dateTotals[d] ?? 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ f, r }: { f: FlowerMatrix; r: FlowerMatrix["rows"][number] }) {
  return (
    <>
      <tr className="border-b border-line-hairline bg-surface-plane/40">
        <td className={`${TD} font-semibold text-ink-primary`}>{r.variety}</td>
        <td className={`${TDN} font-semibold`}>{nf(r.total)}</td>
        {f.dates.map((d) => (
          <td key={d} className={`${TDN} font-semibold`}>
            {cell(r.byDate[d])}
          </td>
        ))}
      </tr>
      {r.lines.map((l) => (
        <tr key={l.grade} className={TROW}>
          <td className={`${TD} pl-6 sm:pl-7 text-ink-secondary`}>{formatGrade(l.grade)}</td>
          <td className={TDN}>{nf(l.total)}</td>
          {f.dates.map((d) => (
            <td key={d} className={TDN}>
              {cell(l.byDate[d])}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
