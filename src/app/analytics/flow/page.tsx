import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { loadFlowReport } from "@/lib/repo/flowReport";
import { AGE_BUCKETS, cleanRange, presetRange, type FlowReport, type FlowRow } from "@/lib/flowReport";
import { avgPrice, monthTitle, type Money } from "@/lib/monthReport";
import { FARMS, FARM_LABELS, FLOWER_TYPE_LABELS, flowerTypesForFarm, getFarmFor } from "@/lib/constants";
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
/** Изменение к прошлому периоду — с ноутбука и шире: на телефоне важнее сами цифры. */
const WIDE = "hidden lg:table-cell";
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

/** Блок страницы. `fold` — свёрнут по умолчанию (третий уровень: подробности, в которые ходят по делу); `summary` — что видно в свёрнутом виде. */
function Card({ title, hint, children, right, fold, summary }: { title: string; hint?: string; children: ReactNode; right?: ReactNode; fold?: boolean; summary?: ReactNode }) {
  if (fold) {
    return (
      <details className="card !p-0 overflow-hidden [&[open]>summary_.chev]:rotate-90 [&[open]>summary]:border-b">
        <summary className="flex items-center gap-2 px-4 sm:px-5 py-3 border-line-hairline cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-surface-plane/50">
          <span className="chev text-ink-muted text-xs transition-transform">▸</span>
          <h2 className="text-[14px] leading-5 font-semibold">{title}</h2>
          {summary && <span className="ml-auto text-xs text-ink-muted text-right truncate">{summary}</span>}
        </summary>
        {hint && <div className="px-4 sm:px-5 pt-3 text-xs text-ink-muted">{hint}</div>}
        {children}
      </details>
    );
  }
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

function DeltaCell({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <td className={`${TDN} ${WIDE} text-ink-muted`}>—</td>;
  const d = Math.round(((now - prev) / prev) * 100);
  // Рост в разы читается как «×3», а не «+214%»; ноль — без плюса.
  const text = d >= 200 ? `×${(now / prev).toLocaleString("ru-RU", { maximumFractionDigits: now / prev >= 10 ? 0 : 1 })}` : d === 0 ? "0%" : `${d > 0 ? "+" : ""}${d}%`;
  return <td className={`${TDN} ${WIDE} text-xs ${d < -10 ? "text-status-critical" : d > 10 ? "text-status-good" : "text-ink-muted"}`}>{text}</td>;
}

type Line = { row: FlowRow; kind?: "group" | "child" };

/** Общая таблица «срезано · продано · выручка · списано · остаток» по строкам одного разреза. Отгружено и выдано — в строке под плитками и в Excel. */
function FlowTable({ lines, total, first, showPrev = true }: { lines: Line[]; total?: FlowRow; first: string; showPrev?: boolean }) {
  const cells = (r: FlowRow, bold = false) => (
    <>
      <td className={TDN}>{nf(r.cut)}</td>
      {showPrev && <DeltaCell now={r.cut} prev={r.prev.cut} />}
      <td className={TDN}>{nf(r.sold.qty)}</td>
      <td className={`${TDN} ${!bold && r.cut && r.sold.qty < r.cut * 0.5 ? "text-status-warning" : "text-ink-secondary"}`}>{pct(r.sold.qty, r.cut)}</td>
      <td className={TDN}>{r.sold.sum ? mln(r.sold.sum) : "—"}</td>
      <td className={TDN}>{r.sold.priced ? nf(avgPrice(r.sold)) : "—"}</td>
      {showPrev && <DeltaCell now={avgPrice(r.sold)} prev={avgPrice(r.prev.sold)} />}
      <td className={`${TDN} ${r.cut && r.writeoff > r.cut * 0.15 ? "text-status-critical" : ""}`}>{nf(r.writeoff)}</td>
      <td className={`${TDN} ${r.cut && r.writeoff > r.cut * 0.15 ? "text-status-critical" : "text-ink-secondary"}`}>{pct(r.writeoff, r.cut)}</td>
      <td className={TDN}>{nf(r.remaining)}</td>
    </>
  );
  return (
    <div className="table-scroll">
      <table className="w-full text-[13px] min-w-[640px]">
        <thead>
          <tr className={THEAD}>
            <th className={TH}>{first}</th>
            <th className={THN}>Срезано</th>
            {showPrev && <th className={`${THN} ${WIDE}`}>Δ</th>}
            <th className={THN}>Продано</th>
            <th className={THN}>от срезки</th>
            <th className={THN}>Выручка</th>
            <th className={THN}>Средняя</th>
            {showPrev && <th className={`${THN} ${WIDE}`}>Δ</th>}
            <th className={THN}>Списано</th>
            <th className={THN}>от срезки</th>
            <th className={THN}>Остаток</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ row: r, kind }) => (
            <tr key={(kind ?? "") + r.key} className={`${TROW} ${kind === "group" ? "bg-surface-plane/40 font-semibold" : ""}`}>
              <td className={`${TD} min-w-[150px] ${kind === "child" ? "pl-6 sm:pl-7" : ""}`}>{r.label}</td>
              {cells(r, kind === "group")}
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
      {share !== undefined && <td className={`${TDN} text-ink-secondary`}>{pct(m.sum, share)}</td>}
    </>
  );
}

function Insights({ items }: { items: FlowReport["insights"] }) {
  if (!items.length) return null;
  const dot = (level: string) => (level === "bad" ? "bg-status-critical" : level === "warn" ? "bg-status-warning" : level === "good" ? "bg-status-good" : "bg-accent");
  const li = (x: FlowReport["insights"][number], i: number) => (
    <li key={i} className="flex gap-2">
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-none ${dot(x.level)}`} />
      <span className="text-ink-secondary">{x.text}</span>
    </li>
  );
  // Сначала то, что требует решения, потом хорошее и справочное; на виду — четыре строки.
  const order = { bad: 0, warn: 1, good: 2, info: 3 } as Record<string, number>;
  const sorted = [...items].sort((a, b) => (a.level === "info" ? -1 : b.level === "info" ? 1 : order[a.level] - order[b.level]));
  const head = sorted.slice(0, 4);
  const rest = sorted.slice(4);
  return (
    <div className="card mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Главное за период</div>
      <ul className="space-y-1.5 text-sm">{head.map(li)}</ul>
      {rest.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer select-none text-accent text-[13px]">ещё {rest.length}</summary>
          <ul className="space-y-1.5 mt-2">{rest.map(li)}</ul>
        </details>
      )}
    </div>
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

/** Ряд кнопок отбора: на телефоне — одна строка с прокруткой пальцем, с планшета — перенос. */
const ROW = "flex items-center gap-2 min-w-0 max-w-full overflow-x-auto scroll-x-hidden sm:flex-wrap sm:overflow-visible";

const VIEWS = [
  { code: "", label: "Цветок и склад" },
  { code: "sales", label: "Продажи и клиенты" },
];

/**
 * «Цифры за период» — единая страница цифр хозяйства (12.11.2026, владелец: «CRM перегружена данными и аналитикой —
 * переосмысли и уменьши шум»; до этого здесь же жил отчёт «Срез · продажи · списания» от 10.11.2026). Период, компания
 * и цветок выбираются сверху и действуют на оба вида: «Цветок и склад» (срезали, продали, списали — по компаниям,
 * цветку, категориям, сортам) и «Продажи и клиенты» (менеджеры с планом, каналы, направления, клиенты). На странице три
 * уровня: четыре главные цифры → что требует внимания → подробности, свёрнутые до нажатия. Расчёт — `buildFlowReport`
 * (`src/lib/flowReport.ts`), правила там же; выгрузка — тот же расчёт в Excel.
 */
export default async function FlowAnalyticsPage({ searchParams }: { searchParams?: { from?: string; to?: string; preset?: string; farm?: string; flower?: string; view?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const today = localDayKey();
  const preset = searchParams?.preset && PRESETS.some((p) => p.code === searchParams.preset) ? searchParams.preset : "";
  const range = preset ? presetRange(preset, today) : cleanRange(searchParams?.from, searchParams?.to, today);
  const farm = searchParams?.farm === FARMS.ESENTAI || searchParams?.farm === FARMS.ROSE_FARM ? searchParams.farm : "";
  const flowers = flowerTypesForFarm(farm || null);
  const flower = searchParams?.flower && flowers.includes(searchParams.flower) ? searchParams.flower : "";
  const view = searchParams?.view === "sales" ? "sales" : "";
  const r = await loadFlowReport(range.from, range.to, farm, flower);
  const isPreset = (code: string) => (preset ? preset === code : (() => { const p = presetRange(code, today); return p.from === range.from && p.to === range.to; })());

  const q = (p: { preset?: string; from?: string; to?: string; farm?: string; flower?: string; view?: string }) => {
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
    const v = p.view ?? view;
    if (v) sp.set("view", v);
    return `/analytics/flow?${sp.toString()}`;
  };
  const pill = (active: boolean) => `flex-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-accent-soft text-accent" : "bg-surface-plane text-ink-secondary hover:text-ink-primary"}`;
  const farmTabs = [
    { code: "", label: "Всё хозяйство" },
    { code: FARMS.ESENTAI, label: FARM_LABELS[FARMS.ESENTAI] ?? "Есентай" },
    { code: FARMS.ROSE_FARM, label: FARM_LABELS[FARMS.ROSE_FARM] ?? "Rose Farm" },
  ];
  const t = r.total;
  const s = r.sales;
  const periodLabel = `${formatDay(r.from)} — ${formatDay(r.to)}`;
  const woShare = t.cut ? t.writeoff / t.cut : 0;
  const soldAllSum = r.channels.reduce((a, c) => a + c.money.sum, 0);
  const exportHref = `/api/analytics/flow?from=${r.from}&to=${r.to}${farm ? `&farm=${farm}` : ""}${flower ? `&flower=${flower}` : ""}`;

  // Компании и цветы — одной таблицей: строка компании, под ней её цветы. С отбором по компании или одной компанией в данных — только цветы.
  const farmLines: Line[] =
    r.byFarm.length > 1
      ? r.byFarm.flatMap((f): Line[] => {
          const own = r.byFlower.filter((x) => getFarmFor(x.flowerType) === f.key);
          // У компании один цветок — одна строка «Компания · цветок»: две одинаковые строки подряд — шум.
          if (own.length === 1) return [{ row: { ...f, label: `${f.label} · ${own[0].label}` }, kind: "group" }];
          return [{ row: f, kind: "group" }, ...own.map((x): Line => ({ row: x, kind: "child" }))];
        })
      : r.byFlower.map((x) => ({ row: x }));
  const facts: { label: string; value: string; note?: string }[] = [
    { label: "Отгружено со склада", value: nf(t.shipped), note: r.toRegion ? `в регион ${nf(r.toRegion)}` : undefined },
    { label: "Средняя цена", value: `${nf(avgPrice(t.sold))} ₸`, note: delta(avgPrice(t.sold), avgPrice(t.prev.sold)) || undefined },
    { label: "Выдано сотрудникам", value: nf(t.takeouts), note: r.toOffice ? `в офис ${nf(r.toOffice)}` : undefined },
    { label: "Остаток склада", value: nf(r.balance.end), note: `на начало ${nf(r.balance.start)}${r.balance.region ? ` · Астана ${nf(r.balance.region)}` : ""}` },
  ];
  const planDone = s.planTotal ? Math.round((s.money.sum / s.planTotal) * 100) : 0;
  const salesFacts: { label: string; value: string; note?: string }[] = [
    { label: "Заявок", value: nf(s.orders), note: delta(s.orders, s.prevOrders) || undefined },
    { label: "Средняя заявка", value: s.orders ? `${nf(s.money.sum / s.orders)} ₸` : "—", note: s.orders ? `${nf(s.money.qty / s.orders)} шт.` : undefined },
    { label: "Продано клиентам", value: `${nf(s.money.qty)} шт.`, note: delta(s.money.qty, s.prev.qty) || undefined },
    { label: "Все каналы", value: mln(t.sold.sum), note: "с регионами и Пожаркой" },
  ];
  const topVariety = r.byVariety[0];
  const topReason = r.writeoffReasons[0];
  const oldStock = r.stockAge.reduce((a, x) => a + x.buckets[2] + x.buckets[3], 0);
  const allStock = r.stockAge.reduce((a, x) => a + x.total, 0);
  const fcPlan = r.forecast.reduce((a, f) => a + f.plan, 0);
  const fcFact = r.forecast.reduce((a, f) => a + f.fact, 0);

  return (
    <div>
      <PageHeader
        area="analytics"
        title="Цифры за период"
        subtitle={`${periodLabel} · ${r.days} дн. · ${farm ? FARM_LABELS[farm] : "Rose Farm и Есентай Агро Хим"}${flower ? ` · ${FLOWER_TYPE_LABELS[flower] ?? flower}` : ""}`}
        icon="chart"
        tabs={analyticsTabsFor(role)}
        actions={
          <a href={exportHref} className="btn-secondary">
            Скачать Excel
          </a>
        }
      />

      {/* Отбор: на телефоне ряды кнопок листаются пальцем в одну строку, а не занимают весь экран. */}
      <div className="card mb-5 !py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <span className="inline-flex flex-none rounded-lg border border-line-strong p-0.5">
            {VIEWS.map((v) => (
              <Link key={v.code} href={q({ view: v.code })} className={v.code === view ? "rounded-md px-3 py-1 text-sm font-medium bg-accent text-white" : "rounded-md px-3 py-1 text-sm text-ink-secondary hover:text-ink-primary"}>
                {v.label}
              </Link>
            ))}
          </span>
          <div className={ROW}>
            {PRESETS.map((p) => (
              <Link key={p.code} href={q({ preset: p.code })} className={pill(isPreset(p.code))}>
                {p.label}
              </Link>
            ))}
          </div>
          <form action="/analytics/flow" className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto sm:ml-auto">
            {farm && <input type="hidden" name="farm" value={farm} />}
            {flower && <input type="hidden" name="flower" value={flower} />}
            {view && <input type="hidden" name="view" value={view} />}
            <input type="date" name="from" defaultValue={range.from} max={today} className="input !py-1.5 !px-2 sm:!px-3 text-[13px] sm:text-sm flex-1 min-w-0 sm:flex-none sm:!w-auto" aria-label="Начало периода" />
            <span className="text-ink-muted">—</span>
            <input type="date" name="to" defaultValue={range.to} max={today} className="input !py-1.5 !px-2 sm:!px-3 text-[13px] sm:text-sm flex-1 min-w-0 sm:flex-none sm:!w-auto" aria-label="Конец периода" />
            <button className="btn-secondary !py-1.5 flex-none" type="submit">
              <span className="sm:hidden">ОК</span>
              <span className="hidden sm:inline">Показать</span>
            </button>
          </form>
        </div>
        <div className={ROW}>
          {farmTabs.map((f) => (
            <Link key={f.code} href={q({ farm: f.code, flower: "" })} className={pill(f.code === farm)}>
              {f.label}
            </Link>
          ))}
          <span className="w-px h-5 bg-line-hairline mx-1 flex-none" />
          <Link href={q({ flower: "" })} className={pill(!flower)}>
            Все цветы
          </Link>
          {flowers.map((f) => (
            <Link key={f} href={q({ flower: f })} className={pill(f === flower)}>
              {FLOWER_TYPE_LABELS[f] ?? f}
            </Link>
          ))}
        </div>
      </div>

      {view === "" ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-3">
            <KpiTile icon="leaf" label="Срезано" value={nf(t.cut)} hint={deltaHint(t.cut, t.prev.cut) || "приёмка основного склада"} />
            <KpiTile icon="order" label="Продано по заявкам" value={nf(t.sold.qty)} hint={`${pct(t.sold.qty, t.cut)} от срезанного${t.prev.sold.qty ? ` · ${delta(t.sold.qty, t.prev.sold.qty)}` : ""}`} />
            <KpiTile icon="wallet" label="Выручка" value={mln(t.sold.sum)} hint={deltaHint(t.sold.sum, t.prev.sold.sum) || "по заявкам периода"} />
            <KpiTile icon="alert" label="Списано" value={nf(t.writeoff)} hint={`${pct(t.writeoff, t.cut)} от срезанного${t.prev.writeoff ? ` · ${delta(t.writeoff, t.prev.writeoff)}` : ""}`} tone={woShare > 0.15 ? "bad" : woShare > 0.08 ? "warn" : undefined} />
          </div>
          <FactsLine facts={facts} />
          <Insights items={r.insights} />

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
            <Card title={r.timeline.unit === "day" ? "По дням" : "По неделям"} hint="Срезано — по дню срезки (нет — приёмки), продано — по дню оформления заявки, отгружено и списано — по дню записи в журнале." right={`Δ — к ${formatDay(r.prevFrom)} — ${formatDay(r.prevTo)}`}>
              <div className="p-3 sm:p-4">
                <FlowTimelineChart data={r.timeline.points} height={240} />
              </div>
            </Card>

            <Card title={r.byFarm.length > 1 ? "По компаниям и цветку" : "По цветку"} hint="«От срезки» у продаж — сколько процентов срезанного ушло по заявкам; у списаний — какая доля срезки пропала. Δ — к прошлому периоду той же длины.">
              <FlowTable lines={farmLines} total={farmLines.length > 1 ? t : undefined} first={r.byFarm.length > 1 ? "Компания · цветок" : "Цветок"} />
            </Card>

            <Card title="По категориям" hint="Категория хризантемы и длина розы и эустомы. Средняя — цена за стебель по заявкам с ценой; Δ средней — к прошлому периоду.">
              <FlowTable lines={r.byGrade.map((row) => ({ row }))} total={t} first="Цветок · категория" />
            </Card>

            <Card fold title="По сортам" summary={topVariety ? `${r.byVariety.length} сортов · больше всего: ${topVariety.label}` : "нет данных"} hint="Сорта по убыванию объёма (срезано + продано), не больше сорока.">
              <FlowTable lines={r.byVariety.map((row) => ({ row }))} first="Цветок · сорт" showPrev={false} />
            </Card>

            <Card
              fold
              title="Списания: причины и возраст"
              summary={t.writeoff ? `${nf(t.writeoff)} шт.${topReason ? ` · ${topReason.reason} ${pct(topReason.qty, t.writeoff)}` : ""}${r.writeoffAgeMedian !== null ? ` · медиана ${Math.round(r.writeoffAgeMedian)} дн. от срезки` : ""}` : "списаний не было"}
              hint="Причины — как их выбрал зав. складом. Возраст — сколько дней прошло от срезки до списания: если списывают на 1–3 день, это брак срезки или приёмки, а не старение."
            >
              <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 mt-3 border-t border-line-hairline">
                <SmallTable head={["Причина", "Шт.", "Доля"]} rows={r.writeoffReasons.map((x) => [x.reason, nf(x.qty), pct(x.qty, t.writeoff)])} empty="Списаний не было." />
                <div className="sm:border-l border-line-hairline">
                  <SmallTable head={["Возраст при списании", "Шт.", "Доля"]} rows={r.writeoffAge.map((x) => [x.bucket, nf(x.qty), pct(x.qty, t.writeoff)])} />
                  {r.writeoffPeople.length > 0 && <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">Кто списывал: {r.writeoffPeople.map((p) => `${p.name} — ${nf(p.qty)}`).join(", ")}.</div>}
                </div>
              </div>
            </Card>

            <Card
              fold
              title="Свежесть склада сейчас"
              summary={allStock ? `${nf(allStock)} шт. · старше недели ${pct(oldStock, allStock)}` : "склад пуст"}
              hint="Остаток основного и офисного складов по возрасту срезки на сегодня. Старше недели — продавать первым или списывать."
            >
              <div className="mt-3 border-t border-line-hairline">
                <SmallTable
                  head={["Цветок", ...AGE_BUCKETS, "Всего", "Старше недели"]}
                  rows={r.stockAge.map((x) => [x.label, ...x.buckets.map((b) => (b ? nf(b) : "—")), nf(x.total), pct(x.buckets[2] + x.buckets[3], x.total)])}
                  empty="Склад пуст."
                  min={480}
                />
                {r.shipAge.length > 0 && (
                  <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
                    Возраст при отгрузке за период: {r.shipAge.map((x) => `${x.label} — медиана ${x.median !== null ? Math.round(x.median) : "—"} дн., старше недели ${pct(x.over7, x.qty)}`).join("; ")}.
                  </div>
                )}
              </div>
            </Card>

            <Card
              fold
              title="План срезки против факта"
              summary={fcPlan ? `план ${nf(fcPlan)} · факт ${nf(fcFact)} · ${pct(fcFact, fcPlan)}` : "плана на эти недели нет"}
              hint="План агронома по неделям («Планы → Срезка → Прогноз агронома»), обрезанный границами периода; факт — приёмка основного склада."
            >
              {r.forecast.length ? (
                <div className="mt-3 border-t border-line-hairline">
                  <SmallTable
                    head={["Цветок / сорт", "План", "Факт", "Выполнение"]}
                    rows={[...r.forecast.map((f) => [f.label, nf(f.plan), nf(f.fact), pct(f.fact, f.plan)]), ...r.forecastVarieties.map((v) => [`· ${v.label}`, nf(v.plan), nf(v.fact), pct(v.fact, v.plan)])]}
                    boldRows={r.forecast.length}
                  />
                </div>
              ) : (
                <div className="px-4 sm:px-5 py-4 text-sm text-ink-muted">На эти недели плана срезки у агронома нет.</div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-3">
            <KpiTile icon="wallet" label="Продано клиентам" value={mln(s.money.sum)} hint={deltaHint(s.money.sum, s.prev.sum) || "по заявкам периода"} />
            {s.planMonth && s.planTotal > 0 ? (
              <KpiTile icon="trophy" label={`План · ${monthTitle(s.planMonth)}`} value={`${planDone}%`} hint={`из ${mln(s.planTotal)}`} tone={planDone >= 100 ? "good" : undefined} />
            ) : (
              <KpiTile icon="order" label="Заявок" value={nf(s.orders)} hint={deltaHint(s.orders, s.prevOrders) || "клиентам"} />
            )}
            <KpiTile icon="client" label="Клиентов" value={nf(s.clientCount)} hint={`новых ${nf(s.newClients)}${s.prevClientCount ? ` · было ${nf(s.prevClientCount)}` : ""}`} />
            <KpiTile icon="tag" label="Средняя цена" value={`${nf(avgPrice(s.money))} ₸`} hint={deltaHint(avgPrice(s.money), avgPrice(s.prev)) || "за стебель"} />
          </div>
          <FactsLine facts={salesFacts} />
          <Insights items={s.insights} />

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
            <Card
              title="Менеджеры"
              hint="Продажи клиентам по дню оформления заявки, без отменённых; регионы, наши магазины и Пожарка не в счёт — как в плане менеджеров. План виден, когда период начинается с первого числа и не выходит за свой месяц."
              right={s.planMonth ? `план — ${monthTitle(s.planMonth)}` : "план виден за период с 1-го числа месяца"}
            >
              <div className="table-scroll">
                <table className="w-full text-[13px] min-w-[620px]">
                  <thead>
                    <tr className={THEAD}>
                      <th className={TH}>Менеджер</th>
                      <th className={THN}>Заявок</th>
                      <th className={THN}>Клиентов</th>
                      <th className={THN}>Шт.</th>
                      <th className={THN}>₸</th>
                      <th className={`${THN} ${WIDE}`}>Δ</th>
                      <th className={THN}>Средняя</th>
                      {s.planMonth && (
                        <>
                          <th className={THN}>План</th>
                          <th className={`${TH} w-[140px]`}>Выполнение</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {s.managers.map((m) => {
                      const done = m.plan ? Math.round((m.money.sum / m.plan) * 100) : 0;
                      return (
                        <tr key={m.email} className={TROW}>
                          <td className={`${TD} min-w-[140px]`}>{m.name}</td>
                          <td className={TDN}>{nf(m.orders)}</td>
                          <td className={TDN}>{nf(m.clients)}</td>
                          <td className={TDN}>{nf(m.money.qty)}</td>
                          <td className={TDN}>{nf(m.money.sum)}</td>
                          <DeltaCell now={m.money.sum} prev={m.prev.sum} />
                          <td className={TDN}>{m.money.priced ? nf(avgPrice(m.money)) : "—"}</td>
                          {s.planMonth && (
                            <>
                              <td className={TDN}>{m.plan ? nf(m.plan) : "—"}</td>
                              <td className={TD}>
                                {m.plan ? (
                                  <span className="flex items-center gap-2">
                                    <span className="flex-1 h-1.5 rounded-full bg-surface-sunk overflow-hidden">
                                      <span className={`block h-full rounded-full ${done >= 100 ? "bg-status-good" : "bg-accent"}`} style={{ width: `${Math.min(100, done)}%` }} />
                                    </span>
                                    <span className="tabular-nums text-xs w-9 text-right">{done}%</span>
                                  </span>
                                ) : (
                                  <span className="text-ink-muted text-xs">плана нет</span>
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {!s.managers.length && (
                      <tr>
                        <td className={`${TD} text-ink-muted`} colSpan={9}>
                          Продаж клиентам за период нет.
                        </td>
                      </tr>
                    )}
                    {s.managers.length > 1 && (
                      <tr className={TTOT}>
                        <td className={TD}>Итого</td>
                        <td className={TDN}>{nf(s.orders)}</td>
                        <td className={TDN}>{nf(s.clientCount)}</td>
                        <td className={TDN}>{nf(s.money.qty)}</td>
                        <td className={TDN}>{nf(s.money.sum)}</td>
                        <DeltaCell now={s.money.sum} prev={s.prev.sum} />
                        <td className={TDN}>{s.money.priced ? nf(avgPrice(s.money)) : "—"}</td>
                        {s.planMonth && (
                          <>
                            <td className={TDN}>{s.planTotal ? nf(s.planTotal) : "—"}</td>
                            <td className={`${TD} tabular-nums text-xs`}>{s.planTotal ? `${planDone}%` : ""}</td>
                          </>
                        )}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2 items-start">
              <Card title="Каналы продаж" hint="Регионы и наши магазины — без цены в заявке: сумма по клиентскому прайсу на день заявки. Заявки со склада Астаны не считаются: этот цветок уже ушёл объёмом на город.">
                <div className="table-scroll">
                  <table className="w-full text-[13px] min-w-[480px]">
                    <thead>
                      <tr className={THEAD}>
                        <th className={TH}>Канал</th>
                        <th className={THN}>Заявок</th>
                        <th className={THN}>Шт.</th>
                        <th className={THN}>₸</th>
                        <th className={THN}>Средняя</th>
                        <th className={THN}>Доля ₸</th>
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
                          <MoneyCells m={c.money} share={soldAllSum} />
                        </tr>
                      ))}
                      <tr className={TTOT}>
                        <td className={TD}>Итого</td>
                        <td className={TDN}>{nf(r.channels.reduce((a, c) => a + c.orders, 0))}</td>
                        <MoneyCells m={t.sold} share={soldAllSum} />
                      </tr>
                    </tbody>
                  </table>
                </div>
                {r.regionSold > 0 && <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">Со склада Астаны за период продано ещё {nf(r.regionSold)} шт. — в итоги не входит.</div>}
              </Card>

              <Card title="Направления" hint="Куда везли заявки клиентов (поле «Направление» в заявке; пусто — Алматы).">
                <div className="table-scroll">
                  <table className="w-full text-[13px] min-w-[420px]">
                    <thead>
                      <tr className={THEAD}>
                        <th className={TH}>Направление</th>
                        <th className={THN}>Шт.</th>
                        <th className={THN}>₸</th>
                        <th className={THN}>Средняя</th>
                        <th className={THN}>Доля ₸</th>
                        <th className={`${THN} ${WIDE}`}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.directions.map((d) => (
                        <tr key={d.name} className={TROW}>
                          <td className={TD}>{d.name}</td>
                          <MoneyCells m={d.money} share={s.money.sum} />
                          <DeltaCell now={d.money.sum} prev={d.prev.sum} />
                        </tr>
                      ))}
                      {!s.directions.length && (
                        <tr>
                          <td className={`${TD} text-ink-muted`} colSpan={6}>
                            Нет продаж.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {s.stores.length > 1 && <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">По складам: {s.stores.map((x) => `${x.name} — ${mln(x.money.sum)}`).join(", ")}.</div>}
              </Card>
            </div>

            <Card title="Крупнейшие клиенты" hint="Первые двенадцать по выручке за период (в Excel — двадцать); Δ — к прошлому периоду той же длины." right={`${nf(s.clientCount)} клиентов за период`}>
              <div className="table-scroll">
                <table className="w-full text-[13px] min-w-[520px]">
                  <thead>
                    <tr className={THEAD}>
                      <th className={TH}>Клиент</th>
                      <th className={THN}>Заявок</th>
                      <th className={THN}>Шт.</th>
                      <th className={THN}>₸</th>
                      <th className={THN}>Средняя</th>
                      <th className={THN}>Доля ₸</th>
                      <th className={`${THN} ${WIDE}`}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.clients.slice(0, 12).map((c, i) => (
                      <tr key={`${c.name}-${i}`} className={TROW}>
                        <td className={`${TD} min-w-[160px]`}>{c.name}</td>
                        <td className={TDN}>{nf(c.orders)}</td>
                        <MoneyCells m={c.money} share={s.money.sum} />
                        <DeltaCell now={c.money.sum} prev={c.prev.sum} />
                      </tr>
                    ))}
                    {!s.clients.length && (
                      <tr>
                        <td className={`${TD} text-ink-muted`} colSpan={7}>
                          Продаж клиентам за период нет.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card fold title="Цены сделок" summary={s.priceBands[0] ? `чаще всего: ${s.priceBands[0].label} по ${nf(s.priceBands[0].price)} ₸` : "нет данных"} hint="По какой цене за стебель реально уходила каждая категория клиентам — двадцать самых частых сочетаний.">
              <div className="mt-3 border-t border-line-hairline">
                <SmallTable head={["Цветок · категория", "Цена, ₸", "Шт."]} rows={s.priceBands.map((b) => [b.label, nf(b.price), nf(b.qty)])} empty="Нет данных." />
              </div>
            </Card>
          </div>
        </>
      )}

      <details className="mt-5 text-xs text-ink-muted px-1">
        <summary className="cursor-pointer select-none">Как считается</summary>
        <p className="mt-2 leading-5">
          Срезано — приёмка основного склада по дню срезки; продано — позиции заявок по дню оформления (без отменённых; у заявок без цены — по прайсу), заявки со склада Астаны не считаются; отгружено — журнал отгрузок с основного и
          офисного складов; списано — журнал списаний; выдано — выдачи сотрудникам и на нужды компании; остаток — основной и офисный склады, на начало и конец периода восстановлен от сегодняшнего. «Продажи и клиенты» — только
          заявки клиентам по цене позиции. Прошлый период — такой же длины впритык перед выбранным ({formatDay(r.prevFrom)} — {formatDay(r.prevTo)}).
        </p>
      </details>
    </div>
  );
}

/** Вторая линия цифр под плитками: то, что нужно реже, — одной строкой, без четырёх лишних плиток. */
function FactsLine({ facts }: { facts: { label: string; value: string; note?: string }[] }) {
  return (
    <div className="card !py-2.5 mb-5 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0">
          <span className="text-ink-muted">{f.label}</span> <span className="font-semibold tabular-nums whitespace-nowrap">{f.value}</span>
          {f.note && <span className="text-ink-muted text-xs"> · {f.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** Простая таблица «название и числа» для свёрнутых блоков. */
function SmallTable({ head, rows, empty, min, boldRows = 0 }: { head: string[]; rows: string[][]; empty?: string; min?: number; boldRows?: number }) {
  return (
    <div className="table-scroll">
      <table className="w-full text-[13px]" style={min ? { minWidth: min } : undefined}>
        <thead>
          <tr className={THEAD}>
            {head.map((h, i) => (
              <th key={h} className={i === 0 ? TH : THN}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={`${TROW} ${ri < boldRows ? "font-semibold" : ""}`}>
              {row.map((c, i) => (
                <td key={i} className={i === 0 ? TD : TDN}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && empty && (
            <tr>
              <td className={`${TD} text-ink-muted`} colSpan={head.length}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
