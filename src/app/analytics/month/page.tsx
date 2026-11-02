import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { localDayKey } from "@/lib/timezone";
import { loadMonthReport } from "@/lib/repo/monthReport";
import { avgPrice, CHANNEL_LABELS, cleanMonth, monthTitle, shiftMonth, type Money } from "@/lib/monthReport";
import { FARMS, FARM_LABELS, FLOWER_TYPE_LABELS } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import Hint from "@/components/Hint";
import MonthWeeksChart from "@/components/MonthWeeksChart";
import { analyticsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TD = "px-3 sm:px-4 py-2";
const TDN = "px-3 sm:px-4 py-2 text-right tabular-nums whitespace-nowrap";
const TH = "px-3 sm:px-4 py-2 font-medium text-left";
const THN = "px-3 sm:px-4 py-2 font-medium text-right";
const TROW = "border-b border-line-hairline last:border-0";
const TTOT = "border-t border-line-hairline bg-surface-plane/60 font-semibold";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const mln = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₸` : `${nf(n)} ₸`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const delta = (now: number, prev: number) => {
  if (!prev) return "";
  const d = Math.round(((now - prev) / prev) * 100);
  return `${d >= 0 ? "+" : ""}${d}% к прошлому`;
};

function Card({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-line-hairline">
        <h2 className="font-display text-[15px] font-bold">{title}</h2>
        {hint && <Hint>{hint}</Hint>}
        {right && <span className="ml-auto text-xs text-ink-muted">{right}</span>}
      </div>
      {children}
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

/**
 * «Итоги месяца» (02.11.2026, владелец: «мощная аналитика по продажам, срезу и другим показателям за месяц — зайти и
 * увидеть всё»). Расчёт — `buildMonthReport` (`src/lib/monthReport.ts`), правила там же; выгрузка — тот же расчёт в Excel.
 */
export default async function MonthAnalyticsPage({ searchParams }: { searchParams?: { month?: string; farm?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const today = localDayKey();
  const month = cleanMonth(searchParams?.month, today);
  const farm = searchParams?.farm === FARMS.ESENTAI || searchParams?.farm === FARMS.ROSE_FARM ? searchParams.farm : "";
  const r = await loadMonthReport(month, farm);

  const q = (p: { month?: string; farm?: string }) => {
    const sp = new URLSearchParams({ month: p.month ?? month, ...((p.farm ?? farm) ? { farm: p.farm ?? farm } : {}) });
    return `/analytics/month?${sp.toString()}`;
  };
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(today.slice(0, 7), -i));
  const next = shiftMonth(month, 1);
  const farmTabs = [
    { code: "", label: "Всё хозяйство" },
    { code: FARMS.ESENTAI, label: FARM_LABELS[FARMS.ESENTAI] ?? "Есентай" },
    { code: FARMS.ROSE_FARM, label: FARM_LABELS[FARMS.ROSE_FARM] ?? "Rose Farm" },
  ];
  const soldTotal = r.sold;
  const multiFlower = new Set(r.grades.map((g) => g.flowerType)).size > 1;

  return (
    <div>
      <PageHeader
        area="analytics"
        title={`Итоги месяца — ${monthTitle(month)}`}
        subtitle={farm ? FARM_LABELS[farm] : "Rose Farm и Есентай Агро Хим вместе"}
        icon="chart"
        tabs={analyticsTabsFor(role)}
        actions={
          <a href={`/api/analytics/month?month=${month}${farm ? `&farm=${farm}` : ""}`} className="btn-secondary">
            Скачать Excel
          </a>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={q({ month: shiftMonth(month, -1) })} className="btn-secondary !py-1.5">
          ← {monthTitle(shiftMonth(month, -1))}
        </Link>
        <form action="/analytics/month" className="flex items-center gap-2">
          {farm && <input type="hidden" name="farm" value={farm} />}
          <select name="month" defaultValue={month} className="input !py-1.5 !w-auto">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthTitle(m)}
              </option>
            ))}
          </select>
          <button className="btn-secondary !py-1.5" type="submit">
            Показать
          </button>
        </form>
        {next <= today.slice(0, 7) && (
          <Link href={q({ month: next })} className="btn-secondary !py-1.5">
            {monthTitle(next)} →
          </Link>
        )}
        <span className="flex flex-wrap gap-1 sm:ml-auto">
          {farmTabs.map((f) => (
            <Link
              key={f.code}
              href={q({ farm: f.code })}
              className={f.code === farm ? "rounded-full px-3 py-1.5 text-sm bg-section-analytics text-white" : "rounded-full px-3 py-1.5 text-sm bg-surface-plane text-ink-secondary hover:text-ink-primary"}
            >
              {f.label}
            </Link>
          ))}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="box" label="Срезано" value={nf(r.cut.total)} hint={delta(r.cut.total, r.cut.prevTotal) || `${r.cut.batches} партий`} />
        <KpiTile icon="truck" label="Ушло по заявкам" value={nf(soldTotal.qty)} hint={`${pct(soldTotal.qty, r.cut.total)} от срезанного`} />
        <KpiTile icon="chart" label="Выручка (все каналы)" value={mln(soldTotal.sum)} hint={delta(soldTotal.sum, r.soldPrev.sum) || "по заявкам месяца"} />
        <KpiTile icon="tag" label="Средняя цена клиентам" value={`${nf(avgPrice(r.clients))} ₸`} hint={delta(avgPrice(r.clients), avgPrice(r.clientsPrev)) || "за стебель"} />
        <KpiTile icon="alert" label="Списано" value={nf(r.writeoff.total)} hint={`${pct(r.writeoff.total, r.cut.total)} от срезанного`} tone={r.cut.total && r.writeoff.total > r.cut.total * 0.15 ? "bad" : undefined} />
        <KpiTile icon="list" label="Из срезки на складе" value={nf(r.leftFromCut)} hint={`${pct(r.leftFromCut, r.cut.total)} ещё лежит`} />
      </div>

      {r.insights.length > 0 && (
        <div className="card mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Главное за месяц</div>
          <ul className="space-y-1.5 text-sm">
            {r.insights.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full flex-none ${
                    x.level === "bad" ? "bg-status-critical" : x.level === "warn" ? "bg-status-warning" : x.level === "good" ? "bg-status-good" : "bg-section-analytics"
                  }`}
                />
                <span className="text-ink-secondary">{x.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5">
        <Card title="По неделям" hint="Срезано — по дню срезки (нет — приёмки), ушло — по дню оформления заявки, списано — по дню списания.">
          <div className="p-3 sm:p-4">
            <MonthWeeksChart data={r.weeks} />
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2 items-start">
          <Card title="Продажи по каналам" hint="Регионы и наши магазины — без цены в заявке: сумма по клиентскому прайсу на день заявки.">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                    <th className={TH}>Канал</th>
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
                        {CHANNEL_LABELS[c.channel]}
                        {c.byList > 0 && <span className="text-xs text-ink-muted"> · по прайсу</span>}
                      </td>
                      <MoneyCells m={c.money} share={soldTotal.qty} />
                    </tr>
                  ))}
                  <tr className={TTOT}>
                    <td className={TD}>Итого</td>
                    <MoneyCells m={soldTotal} share={soldTotal.qty} />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
              Клиенты: {nf(r.clients.orders)} заявок, {nf(r.clients.clientCount)} клиентов (новых — {nf(r.clients.newClients)}), средняя заявка{" "}
              {nf(r.clients.orders ? r.clients.qty / r.clients.orders : 0)} шт. / {nf(r.clients.orders ? r.clients.sum / r.clients.orders : 0)} ₸. Прошлый месяц
              клиентам: {nf(r.clientsPrev.qty)} шт. на {mln(r.clientsPrev.sum)}.
            </div>
          </Card>

          <Card title="Склад за месяц">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Срезано (принято на основной склад)", r.cut.total, `${r.cut.batches} партий, ${r.cut.receiveDays} дней приёмки`],
                  ["Ушло по заявкам месяца (все каналы)", soldTotal.qty, pct(soldTotal.qty, r.cut.total)],
                  ["Отгружено (журнал отгрузок месяца)", r.shipped, pct(r.shipped, r.cut.total)],
                  ["Списано за месяц", r.writeoff.total, `из срезки этого месяца — ${nf(r.writeoff.fromMonthCut)}`],
                  ["Выдано сотрудникам", r.takeouts.qty, r.takeouts.sum ? `на ${nf(r.takeouts.sum)} ₸` : ""],
                  ["Из срезки месяца сейчас на складе", r.leftFromCut, pct(r.leftFromCut, r.cut.total)],
                ].map(([label, v, note]) => (
                  <tr key={String(label)} className={TROW}>
                    <td className={TD}>{label}</td>
                    <td className={TDN}>{nf(Number(v))}</td>
                    <td className={`${TD} text-xs text-ink-muted`}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.writeoff.byReason.length > 0 && (
              <div className="px-4 sm:px-5 py-3 text-xs text-ink-muted border-t border-line-hairline">
                Причины списания: {r.writeoff.byReason.slice(0, 5).map((x) => `${x.reason} — ${nf(x.qty)}`).join("; ")}
              </div>
            )}
          </Card>
        </div>

        <Card title="По категориям" hint="Продано — все каналы; средняя клиентам и сентябрь/прошлый месяц — только продажи клиентам (там цена своя у каждой заявки).">
          <div className="table-scroll">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                  <th className={TH}>Категория</th>
                  <th className={THN}>Срезано</th>
                  <th className={THN}>Ушло</th>
                  <th className={THN}>Ушло от срезки</th>
                  <th className={THN}>₸ (все каналы)</th>
                  <th className={THN}>Клиентам, шт.</th>
                  <th className={THN}>Средняя клиентам</th>
                  <th className={THN}>Прошлый месяц</th>
                  <th className={THN}>Списано</th>
                </tr>
              </thead>
              <tbody>
                {r.grades.map((g) => {
                  const a = avgPrice(g.clients);
                  const d = g.clientsPrevAvg ? Math.round(((a - g.clientsPrevAvg) / g.clientsPrevAvg) * 100) : null;
                  return (
                    <tr key={`${g.flowerType}|${g.grade}`} className={TROW}>
                      <td className={TD}>{multiFlower ? g.label : g.label.replace(/^[^·]+· /, "")}</td>
                      <td className={TDN}>{nf(g.cut)}</td>
                      <td className={TDN}>{nf(g.sold.qty)}</td>
                      <td className={TDN}>{g.cut ? pct(g.sold.qty, g.cut) : "—"}</td>
                      <td className={TDN}>{nf(g.sold.sum)}</td>
                      <td className={TDN}>{nf(g.clients.qty)}</td>
                      <td className={TDN}>{a ? nf(a) : "—"}</td>
                      <td className={TDN}>
                        {g.clientsPrevAvg ? nf(g.clientsPrevAvg) : "—"}
                        {d !== null && <span className={d >= 0 ? "text-status-good" : "text-status-critical"}> {d >= 0 ? "+" : ""}{d}%</span>}
                      </td>
                      <td className={TDN}>{g.writeoff ? nf(g.writeoff) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2 items-start">
          <Card title="Менеджеры" hint="Только продажи клиентам, по менеджеру заявки.">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                    <th className={TH}>Менеджер</th>
                    <th className={THN}>Шт.</th>
                    <th className={THN}>₸</th>
                    <th className={THN}>Средняя</th>
                    <th className={THN}>Заявок</th>
                    <th className={THN}>Клиентов</th>
                  </tr>
                </thead>
                <tbody>
                  {r.managers.map((m) => (
                    <tr key={m.name} className={TROW}>
                      <td className={TD}>{m.name}</td>
                      <MoneyCells m={m.money} />
                      <td className={TDN}>{nf(m.orders)}</td>
                      <td className={TDN}>{nf(m.clients)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Направления и склады" hint="Продажи клиентам: куда везли и с какого склада отгружали.">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[440px]">
                <thead>
                  <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                    <th className={TH}>Направление</th>
                    <th className={THN}>Шт.</th>
                    <th className={THN}>₸</th>
                    <th className={THN}>Средняя</th>
                    <th className={THN}>Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {r.directions.map((d) => (
                    <tr key={d.name} className={TROW}>
                      <td className={TD}>{d.name}</td>
                      <MoneyCells m={d.money} share={r.clients.qty} />
                    </tr>
                  ))}
                  {r.stores.length > 1 &&
                    r.stores.map((s) => (
                      <tr key={`s-${s.name}`} className={TROW}>
                        <td className={`${TD} text-ink-muted`}>Склад: {s.name}</td>
                        <MoneyCells m={s.money} share={r.clients.qty} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2 items-start">
          <Card title="Крупнейшие клиенты" right={`топ ${r.topClients.length}`}>
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                    <th className={TH}>Клиент</th>
                    <th className={THN}>Шт.</th>
                    <th className={THN}>₸</th>
                    <th className={THN}>Средняя</th>
                    <th className={THN}>Доля</th>
                    <th className={THN}>Прошлый мес., шт.</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topClients.map((c, i) => (
                    <tr key={`${c.name}-${i}`} className={TROW}>
                      <td className={TD}>{c.name}</td>
                      <MoneyCells m={c.money} share={r.clients.qty} />
                      <td className={TDN}>{c.prevQty ? nf(c.prevQty) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="По сортам">
            <div className="table-scroll">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                    <th className={TH}>Сорт</th>
                    <th className={THN}>Срезано</th>
                    <th className={THN}>Ушло</th>
                    <th className={THN}>₸</th>
                    <th className={THN}>Средняя</th>
                    <th className={THN}>Списано</th>
                  </tr>
                </thead>
                <tbody>
                  {r.varieties.slice(0, 30).map((v) => (
                    <tr key={`${v.flowerType}|${v.variety}`} className={TROW}>
                      <td className={TD}>
                        {multiFlower ? `${FLOWER_TYPE_LABELS[v.flowerType] ?? v.flowerType} ` : ""}
                        {v.variety}
                      </td>
                      <td className={TDN}>{nf(v.cut)}</td>
                      <td className={TDN}>{nf(v.sold.qty)}</td>
                      <td className={TDN}>{nf(v.sold.sum)}</td>
                      <td className={TDN}>{v.sold.priced ? nf(avgPrice(v.sold)) : "—"}</td>
                      <td className={TDN}>{v.writeoff ? nf(v.writeoff) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2 items-start">
          <Card title="По каким ценам продавали" hint="Продажи клиентам: категория и цена за стебель, крупнейшие объёмы.">
            <table className="w-full text-sm">
              <tbody>
                {r.priceBands.map((b, i) => (
                  <tr key={i} className={TROW}>
                    <td className={TD}>{multiFlower ? b.label : b.label.replace(/^[^·]+· /, "")}</td>
                    <td className={TDN}>{b.price.toLocaleString("ru-RU")} ₸</td>
                    <td className={TDN}>{nf(b.qty)} шт.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Другие способы счёта" hint="Те же продажи, посчитанные иначе — чтобы сверить с 1С, Kaspi и отчётами точки.">
            <table className="w-full text-sm">
              <tbody>
                {r.views.map((v) => (
                  <tr key={v.label} className={TROW}>
                    <td className={TD}>
                      {v.label}
                      <div className="text-xs text-ink-muted">{v.detail}</div>
                    </td>
                    <td className={TDN}>{v.qty ? `${nf(v.qty)} шт.` : ""}</td>
                    <td className={TDN}>{nf(v.sum)} ₸</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}
