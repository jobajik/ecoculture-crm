import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { loadFlowReport } from "@/lib/repo/flowReport";
import { AGE_BUCKETS, cleanRange, presetRange, type FlowRow } from "@/lib/flowReport";
import { avgPrice, type Money } from "@/lib/monthReport";
import { FARMS, FARM_LABELS, FLOWER_TYPE_LABELS, flowerTypesForFarm } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import Hint from "@/components/Hint";
import FlowTimelineChart from "@/components/FlowTimelineChart";
import { analyticsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TD = "px-2.5 sm:px-3 py-2";
const TDN = "px-2 sm:px-2.5 py-2 text-right tabular-nums whitespace-nowrap";
const TH = "px-2.5 sm:px-3 py-2 font-medium text-left";
const THN = "px-2 sm:px-2.5 py-2 font-medium text-right";
const TROW = "border-b border-line-hairline last:border-0";
const TTOT = "border-t border-line-hairline bg-surface-plane/60 font-semibold";
const WIDE = "hidden xl:table-cell";
const THEAD = "border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const mln = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₸` : `${nf(n)} ₸`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const delta = (now: number, prev: number) => {
  if (!prev) return "";
  const d = Math.round(((now - prev) / prev) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
};
const deltaHint = (now: number, prev: number, what = "к прошлому периоду") => (prev ? `${delta(now, prev)} ${what}` : "");

function Card({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-line-hairline">
        <h2 className="text-[14px] leading-5 font-semibold">{title}</h2>
        {hint && <Hint>{hint}</Hint>}
        {right && <span className="ml-auto text-xs text-ink-muted">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** Изменение к прошлому периоду. На экране уже 1280 px прячется: четырнадцать колонок туда не помещаются, а главное — сами цифры. */
function DeltaCell({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <td className={`${TDN} ${WIDE} text-ink-muted`}>—</td>;
  const d = Math.round(((now - prev) / prev) * 100);
  return <td className={`${TDN} ${WIDE} ${d < -10 ? "text-status-critical" : d > 10 ? "text-status-good" : "text-ink-muted"}`}>{`${d >= 0 ? "+" : ""}${d}%`}</td>;
}

/** Общая таблица «срезано · продано · отгружено · списано · выдано · остаток» по строкам одного разреза. */
function FlowTable({ rows, total, first, showPrice = true, showPrev = true }: { rows: FlowRow[]; total?: FlowRow; first: string; showPrice?: boolean; showPrev?: boolean }) {
  const cells = (r: FlowRow, bold = false) => (
    <>
      <td className={TDN}>{nf(r.cut)}</td>
      {showPrev && <DeltaCell now={r.cut} prev={r.prev.cut} />}
      <td className={TDN}>{nf(r.sold.qty)}</td>
      <td className={`${TDN} ${!bold && r.cut && r.sold.qty < r.cut * 0.5 ? "text-status-warning" : ""}`}>{pct(r.sold.qty, r.cut)}</td>
      {showPrev && <DeltaCell now={r.sold.qty} prev={r.prev.sold.qty} />}
      {showPrice && (
        <>
          <td className={TDN}>{r.sold.sum ? mln(r.sold.sum) : "—"}</td>
          <td className={TDN}>{r.sold.priced ? nf(avgPrice(r.sold)) : "—"}</td>
          {showPrev && <DeltaCell now={avgPrice(r.sold)} prev={avgPrice(r.prev.sold)} />}
        </>
      )}
      <td className={TDN}>{nf(r.shipped)}</td>
      <td className={`${TDN} ${r.cut && r.writeoff > r.cut * 0.15 ? "text-status-critical" : ""}`}>{nf(r.writeoff)}</td>
      <td className={`${TDN} ${r.cut && r.writeoff > r.cut * 0.15 ? "text-status-critical" : ""}`}>{pct(r.writeoff, r.cut)}</td>
      <td className={`${TDN} ${WIDE}`}>{r.takeouts ? nf(r.takeouts) : "—"}</td>
      <td className={TDN}>{nf(r.remaining)}</td>
    </>
  );
  return (
    <div className="table-scroll">
      <table className="w-full text-[13px] min-w-[720px]">
        <thead>
          <tr className={THEAD}>
            <th className={TH}>{first}</th>
            <th className={THN}>Срезано</th>
            {showPrev && <th className={`${THN} ${WIDE}`}>Δ</th>}
            <th className={THN}>Продано</th>
            <th className={THN}>от срезки</th>
            {showPrev && <th className={`${THN} ${WIDE}`}>Δ</th>}
            {showPrice && (
              <>
                <th className={THN}>Выручка</th>
                <th className={THN}>Средняя</th>
                {showPrev && <th className={`${THN} ${WIDE}`}>Δ</th>}
              </>
            )}
            <th className={THN}>Отгружено</th>
            <th className={THN}>Списано</th>
            <th className={THN}>от срезки</th>
            <th className={`${THN} ${WIDE}`}>Выдано</th>
            <th className={THN}>Остаток</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={TROW}>
              <td className={`${TD} min-w-[150px]`}>{r.label}</td>
              {cells(r)}
            </tr>
          ))}
          {total && (
            <tr className={TTOT}>
              <td className={TD}>Итого</td>
              {cells(total, true)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MoneyCells({ m, share }: { m: Money; share?: number }) {
  return (
    <>
      <td className={TDN}>{nf(m.qty)}</td>
      <td className={TDN}>{nf(m.sum)}</td>
      <td className={TDN}>{m.priced ? nf(avgPrice(m)) : "—"}</td>
      {share !== undefined && <td className={TDN}>{pct(m.qty, share)}</td>}
    </>
  );
}

const PRESETS: { code: string; label: string }[] = [
  { code: "7", label: "7 дней" },
  { code: "week", label: "Эта неделя" },
  { code: "30", label: "30 дней" },
  { code: "month", label: "Этот месяц" },
  { code: "prev-month", label: "Прошлый месяц" },
  { code: "90", label: "90 дней" },
];

/**
 * «Срез · продажи · списания» (10.11.2026, владелец: «аналитика по срезали, продали, списали по каждому цветку, по
 * компаниям, по категориям, с возможностью выбора периода»). Расчёт — `buildFlowReport` (`src/lib/flowReport.ts`),
 * правила там же; выгрузка — тот же расчёт в Excel.
 */
export default async function FlowAnalyticsPage({ searchParams }: { searchParams?: { from?: string; to?: string; preset?: string; farm?: string; flower?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const today = localDayKey();
  const preset = searchParams?.preset && PRESETS.some((p) => p.code === searchParams.preset) ? searchParams.preset : "";
  const range = preset ? presetRange(preset, today) : cleanRange(searchParams?.from, searchParams?.to, today);
  const farm = searchParams?.farm === FARMS.ESENTAI || searchParams?.farm === FARMS.ROSE_FARM ? searchParams.farm : "";
  const flowers = flowerTypesForFarm(farm || null);
  const flower = searchParams?.flower && flowers.includes(searchParams.flower) ? searchParams.flower : "";
  const r = await loadFlowReport(range.from, range.to, farm, flower);
  const isPreset = (code: string) => (preset ? preset === code : (() => { const p = presetRange(code, today); return p.from === range.from && p.to === range.to; })());

  const q = (p: { preset?: string; from?: string; to?: string; farm?: string; flower?: string }) => {
    const sp = new URLSearchParams();
    const pr = p.preset ?? (p.from || p.to ? "" : preset);
    if (pr) sp.set("preset", pr);
    else {
      sp.set("from", p.from ?? range.from);
      sp.set("to", p.to ?? range.to);
    }
    const f = p.farm ?? farm;
    if (f) sp.set("farm", f);
    const fl = p.flower ?? flower;
    if (fl && (f ? flowerTypesForFarm(f).includes(fl) : true)) sp.set("flower", fl);
    return `/analytics/flow?${sp.toString()}`;
  };
  const pill = (active: boolean) => (active ? "rounded-lg px-3 py-1.5 text-sm bg-accent-soft text-accent" : "rounded-lg px-3 py-1.5 text-sm bg-surface-plane text-ink-secondary hover:text-ink-primary");
  const farmTabs = [
    { code: "", label: "Всё хозяйство" },
    { code: FARMS.ESENTAI, label: FARM_LABELS[FARMS.ESENTAI] ?? "Есентай" },
    { code: FARMS.ROSE_FARM, label: FARM_LABELS[FARMS.ROSE_FARM] ?? "Rose Farm" },
  ];
  const t = r.total;
  const periodLabel = `${formatDay(r.from)} — ${formatDay(r.to)}`;
  const woShare = t.cut ? t.writeoff / t.cut : 0;
  const soldAll = r.channels.reduce((s, c) => s + c.money.qty, 0);
  const exportHref = `/api/analytics/flow?from=${r.from}&to=${r.to}${farm ? `&farm=${farm}` : ""}${flower ? `&flower=${flower}` : ""}`;

  return (
    <div>
      <PageHeader
        area="analytics"
        title="Срез · продажи · списания"
        subtitle={`${periodLabel} · ${r.days} дн. · ${farm ? FARM_LABELS[farm] : "Rose Farm и Есентай Агро Хим"}${flower ? ` · ${FLOWER_TYPE_LABELS[flower] ?? flower}` : ""}`}
        icon="chart"
        tabs={analyticsTabsFor(role)}
        actions={
          <a href={exportHref} className="btn-secondary">
            Скачать Excel
          </a>
        }
      />

      <div className="card mb-5 !py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted mr-1">Период:</span>
          {PRESETS.map((p) => (
            <Link key={p.code} href={q({ preset: p.code })} className={pill(isPreset(p.code))}>
              {p.label}
            </Link>
          ))}
          <form action="/analytics/flow" className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {farm && <input type="hidden" name="farm" value={farm} />}
            {flower && <input type="hidden" name="flower" value={flower} />}
            <input type="date" name="from" defaultValue={range.from} max={today} className="input !py-1.5 !w-auto" />
            <span className="text-ink-muted">—</span>
            <input type="date" name="to" defaultValue={range.to} max={today} className="input !py-1.5 !w-auto" />
            <button className="btn-secondary !py-1.5" type="submit">
              Показать
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs text-ink-muted mr-1">Компания:</span>
          {farmTabs.map((f) => (
            <Link key={f.code} href={q({ farm: f.code, flower: "" })} className={pill(f.code === farm)}>
              {f.label}
            </Link>
          ))}
          <span className="text-xs text-ink-muted ml-3 mr-1">Цветок:</span>
          <Link href={q({ flower: "" })} className={pill(!flower)}>
            Все
          </Link>
          {flowers.map((f) => (
            <Link key={f} href={q({ flower: f })} className={pill(f === flower)}>
              {FLOWER_TYPE_LABELS[f] ?? f}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="leaf" label="Срезано" value={nf(t.cut)} hint={deltaHint(t.cut, t.prev.cut) || "приёмка основного склада"} />
        <KpiTile icon="order" label="Продано по заявкам" value={nf(t.sold.qty)} hint={`${pct(t.sold.qty, t.cut)} от срезанного${t.prev.sold.qty ? ` · ${delta(t.sold.qty, t.prev.sold.qty)}` : ""}`} />
        <KpiTile icon="wallet" label="Выручка" value={mln(t.sold.sum)} hint={deltaHint(t.sold.sum, t.prev.sold.sum) || "по заявкам периода"} />
        <KpiTile icon="tag" label="Средняя цена" value={`${nf(avgPrice(t.sold))} ₸`} hint={deltaHint(avgPrice(t.sold), avgPrice(t.prev.sold)) || "за стебель"} />
        <KpiTile icon="truck" label="Отгружено со склада" value={nf(t.shipped)} hint={r.toRegion ? `в регион ${nf(r.toRegion)}` : "по журналу отгрузок"} />
        <KpiTile icon="alert" label="Списано" value={nf(t.writeoff)} hint={`${pct(t.writeoff, t.cut)} от срезанного${t.prev.writeoff ? ` · ${delta(t.writeoff, t.prev.writeoff)}` : ""}`} tone={woShare > 0.15 ? "bad" : woShare > 0.08 ? "warn" : undefined} />
        <KpiTile icon="client" label="Выдано и в офис" value={nf(t.takeouts)} hint={r.toOffice ? `в офис перемещено ${nf(r.toOffice)}` : "сотрудникам и на нужды компании"} />
        <KpiTile icon="box" label="Остаток склада" value={nf(r.balance.end)} hint={`на начало ${nf(r.balance.start)}${r.balance.region ? ` · Астана ${nf(r.balance.region)}` : ""}`} />
      </div>

      {r.insights.length > 0 && (
        <div className="card mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Главное за период</div>
          <ul className="space-y-1.5 text-sm">
            {r.insights.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-none ${x.level === "bad" ? "bg-status-critical" : x.level === "warn" ? "bg-status-warning" : x.level === "good" ? "bg-status-good" : "bg-section-analytics"}`} />
                <span className="text-ink-secondary">{x.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5">
        <Card title={r.timeline.unit === "day" ? "По дням" : "По неделям"} hint="Срезано — по дню срезки (нет — приёмки), продано — по дню оформления заявки, отгружено и списано — по дню записи в журнале." right={`прошлый период: ${formatDay(r.prevFrom)} — ${formatDay(r.prevTo)}`}>
          <div className="p-3 sm:p-4">
            <FlowTimelineChart data={r.timeline.points} />
          </div>
        </Card>

        <Card title="По компаниям" hint="Rose Farm — роза, эустома и своя хризантема; Есентай Агро Хим — хризантема. Δ — к прошлому периоду той же длины.">
          <FlowTable rows={r.byFarm} total={r.byFarm.length > 1 ? t : undefined} first="Компания" />
        </Card>

        <Card title="По цветку" hint="«От срезки» у продаж — сколько процентов срезанного ушло по заявкам; у списаний — какая доля срезки пропала.">
          <FlowTable rows={r.byFlower} total={r.byFlower.length > 1 ? t : undefined} first="Цветок" />
        </Card>

        <Card title="По категориям" hint="Категория хризантемы и длина розы/эустомы. Средняя — цена за стебель по заявкам с ценой; Δ средней — к прошлому периоду.">
          <FlowTable rows={r.byGrade} total={t} first="Цветок · категория" />
        </Card>

        <Card title="По сортам" hint="Сорта по убыванию объёма (срезано + продано), не больше сорока." right={`${r.byVariety.length} сортов`}>
          <FlowTable rows={r.byVariety} first="Цветок · сорт" showPrev={false} />
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2 items-start">
          <Card title="Продажи по каналам" hint="Регионы и наши магазины — без цены в заявке: сумма по клиентскому прайсу на день заявки. Заявки со склада Астаны не считаются: этот цветок уже ушёл объёмом на город.">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className={THEAD}>
                    <th className={TH}>Канал</th>
                    <th className={THN}>Заявок</th>
                    <th className={THN}>Шт.</th>
                    <th className={THN}>₸</th>
                    <th className={THN}>Средняя</th>
                    <th className={THN}>Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {r.channels.map((c) => (
                    <tr key={c.channel} className={TROW}>
                      <td className={TD}>
                        {c.label}
                        {c.byList > 0 && <span className="text-xs text-ink-muted"> · по прайсу</span>}
                      </td>
                      <td className={TDN}>{nf(c.orders)}</td>
                      <MoneyCells m={c.money} share={soldAll} />
                    </tr>
                  ))}
                  <tr className={TTOT}>
                    <td className={TD}>Итого</td>
                    <td className={TDN}>{nf(r.channels.reduce((s, c) => s + c.orders, 0))}</td>
                    <MoneyCells m={t.sold} share={soldAll} />
                  </tr>
                </tbody>
              </table>
            </div>
            {r.regionSold > 0 && <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">Со склада Астаны за период продано ещё {nf(r.regionSold)} шт. — в итоги не входит.</div>}
          </Card>

          <Card title="Списания" hint="Причины — как их выбрал зав. складом. Возраст — сколько дней прошло от срезки до списания: если списывают на 1–3 день, это брак срезки или приёмки, а не старение." right={r.writeoffAgeMedian !== null ? `медиана возраста ${Math.round(r.writeoffAgeMedian)} дн.` : undefined}>
            <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2">
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={THEAD}>
                      <th className={TH}>Причина</th>
                      <th className={THN}>Шт.</th>
                      <th className={THN}>Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.writeoffReasons.map((x) => (
                      <tr key={x.reason} className={TROW}>
                        <td className={TD}>{x.reason}</td>
                        <td className={TDN}>{nf(x.qty)}</td>
                        <td className={TDN}>{pct(x.qty, t.writeoff)}</td>
                      </tr>
                    ))}
                    {!r.writeoffReasons.length && (
                      <tr>
                        <td className={`${TD} text-ink-muted`} colSpan={3}>
                          Списаний не было.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="table-scroll sm:border-l border-line-hairline">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={THEAD}>
                      <th className={TH}>Возраст при списании</th>
                      <th className={THN}>Шт.</th>
                      <th className={THN}>Доля</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.writeoffAge.map((x) => (
                      <tr key={x.bucket} className={TROW}>
                        <td className={TD}>{x.bucket}</td>
                        <td className={TDN}>{nf(x.qty)}</td>
                        <td className={TDN}>{pct(x.qty, t.writeoff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.writeoffPeople.length > 0 && (
                  <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
                    Кто списывал: {r.writeoffPeople.map((p) => `${p.name} — ${nf(p.qty)}`).join(", ")}.
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2 items-start">
          <Card title="Свежесть склада сейчас" hint="Остаток основного и офисного складов по возрасту срезки на сегодня. Старше недели — продавать первым или списывать.">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className={THEAD}>
                    <th className={TH}>Цветок</th>
                    {AGE_BUCKETS.map((b) => (
                      <th key={b} className={THN}>
                        {b}
                      </th>
                    ))}
                    <th className={THN}>Всего</th>
                    <th className={THN}>Старше недели</th>
                  </tr>
                </thead>
                <tbody>
                  {r.stockAge.map((x) => (
                    <tr key={x.flowerType} className={TROW}>
                      <td className={TD}>{x.label}</td>
                      {x.buckets.map((q, i) => (
                        <td key={i} className={TDN}>
                          {q ? nf(q) : "—"}
                        </td>
                      ))}
                      <td className={TDN}>{nf(x.total)}</td>
                      <td className={`${TDN} ${x.total && x.buckets[2] + x.buckets[3] > x.total * 0.3 ? "text-status-critical" : ""}`}>{pct(x.buckets[2] + x.buckets[3], x.total)}</td>
                    </tr>
                  ))}
                  {!r.stockAge.length && (
                    <tr>
                      <td className={`${TD} text-ink-muted`} colSpan={7}>
                        Склад пуст.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {r.shipAge.length > 0 && (
              <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
                Возраст при отгрузке за период: {r.shipAge.map((x) => `${x.label} — медиана ${x.median !== null ? Math.round(x.median) : "—"} дн., старше недели ${pct(x.over7, x.qty)}`).join("; ")}.
              </div>
            )}
          </Card>

          <Card title="План срезки против факта" hint="План агронома по неделям (вкладка «Прогноз срезки»), обрезанный границами периода; факт — приёмка основного склада.">
            {r.forecast.length ? (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={THEAD}>
                      <th className={TH}>Цветок / сорт</th>
                      <th className={THN}>План</th>
                      <th className={THN}>Факт</th>
                      <th className={THN}>Выполнение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.forecast.map((f) => (
                      <tr key={f.flowerType} className={`${TROW} font-semibold`}>
                        <td className={TD}>{f.label}</td>
                        <td className={TDN}>{nf(f.plan)}</td>
                        <td className={TDN}>{nf(f.fact)}</td>
                        <td className={`${TDN} ${f.plan && f.fact < f.plan * 0.8 ? "text-status-warning" : ""}`}>{pct(f.fact, f.plan)}</td>
                      </tr>
                    ))}
                    {r.forecastVarieties.map((v) => (
                      <tr key={v.label} className={TROW}>
                        <td className={`${TD} text-ink-secondary pl-6`}>{v.label}</td>
                        <td className={TDN}>{nf(v.plan)}</td>
                        <td className={TDN}>{nf(v.fact)}</td>
                        <td className={`${TDN} ${v.plan && v.fact < v.plan * 0.8 ? "text-status-warning" : ""}`}>{pct(v.fact, v.plan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 sm:px-5 py-4 text-sm text-ink-muted">На эти недели плана срезки у агронома нет.</div>
            )}
          </Card>
        </div>

        <div className="text-xs text-ink-muted px-1">
          Как считается: срезано — приёмка основного склада по дню срезки; продано — позиции заявок по дню оформления (без отменённых; у заявок без цены — по прайсу), заявки со склада Астаны не считаются; отгружено — журнал
          отгрузок с основного и офисного складов; списано — журнал списаний; выдано — выдачи сотрудникам и на нужды компании; остаток — основной и офисный склады, на начало и конец периода восстановлен от сегодняшнего.
          Прошлый период — такой же длины впритык перед выбранным.
        </div>
      </div>
    </div>
  );
}
