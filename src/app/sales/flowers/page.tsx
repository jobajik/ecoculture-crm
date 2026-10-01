import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { prefetchTables } from "@/lib/sheets";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  SHEET_TABS,
  formatGrade,
  gradeColumnLabel,
  gradeColumnLabelFor,
  isValidPeriod,
  periodLabel,
  periodOf,
} from "@/lib/constants";
import { buildFlowerSales, POINT_ROW_KEY } from "@/lib/flowerSales";
import { canOpen } from "@/lib/access";
import PageHeader from "@/components/PageHeader";
import PeriodPicker from "@/components/PeriodPicker";
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import FlowerSalesBreakdown from "@/components/FlowerSalesBreakdown";
import { salesTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const money = (n: number) => `${nf(n)} ₸`;
const FLOWERS = ["rose", "chrysanthemum", "eustoma"];

/**
 * «Продажи → Цветы»: что продали за месяц по цветку, ростовке или категории,
 * сорту и менеджеру. Расчёт — `buildFlowerSales()` в `src/lib/flowerSales.ts`.
 */
export default async function FlowerSalesPage({ searchParams }: { searchParams?: { period?: string; flower?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!canOpen(role, "/sales/flowers")) redirect("/?error=forbidden");

  const period = searchParams?.period && isValidPeriod(searchParams.period) ? searchParams.period : periodOf(new Date());
  const flower = searchParams?.flower && FLOWERS.includes(searchParams.flower) ? searchParams.flower : null;

  // Три вкладки — одним запросом к Google (грабли 1.17).
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [orders, users] = await Promise.all([listOrdersWithItems(), listUsers()]);
  const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));

  const r = buildFlowerSales({ orders, period, flower, nameByEmail });
  const t = r.totals;
  const p = r.prevTotals;
  const hasPrev = p.stems > 0;
  const prevName = periodLabel(r.prevPeriod).split(" ")[0].toLowerCase();
  const gradeLabel = flower ? gradeColumnLabel(flower) : gradeColumnLabelFor(FLOWERS);
  const flowerHref = (f: string | null) => `/sales/flowers?period=${period}${f ? `&flower=${f}` : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader area="sales" title="Продажи по цветам" icon="leaf" tabs={salesTabsFor(role)} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PeriodPicker period={period} />
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-hairline bg-surface-plane p-1">
          {[null, ...FLOWERS].map((f) => (
            <Link
              key={f ?? "all"}
              href={flowerHref(f)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                f === flower ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              {f ? FLOWER_TYPE_LABELS_PLURAL[f] : "Все цветы"}
            </Link>
          ))}
        </div>
        <span className="text-sm text-ink-muted">
          {hasPrev ? `сравнение с: ${prevName}` : `за ${prevName} продаж нет — сравнивать не с чем`}
          <Hint>
            Месяц — по дню оформления заявки, как в рейтинге. Отменённые заявки, наши магазины, опт на город
            и точка на базаре не считаются: это не продажа клиенту. Точка на базаре показана отдельной строкой у
            менеджеров — для справки. «Средняя цена» — сумма по позициям, делённая на штуки.
          </Hint>
        </span>
      </div>

      <section className="card">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-5">
          <Stat title="Продано штук" value={nf(t.stems)} now={t.stems} before={p.stems} hasPrev={hasPrev} />
          <Stat title="На сумму" value={money(t.amount)} now={t.amount} before={p.amount} hasPrev={hasPrev} />
          <Stat
            title="Средняя цена стебля"
            value={t.stems > 0 ? money(t.amount / t.stems) : "—"}
            now={t.stems > 0 ? t.amount / t.stems : 0}
            before={p.stems > 0 ? p.amount / p.stems : 0}
            hasPrev={hasPrev && t.stems > 0}
          />
          <Stat title="Заявок" value={nf(t.orders)} note={`клиентов: ${nf(t.clients)}`} now={t.orders} before={p.orders} hasPrev={hasPrev} />
        </dl>
      </section>

      <FlowerSalesBreakdown
        rows={{ grade: r.byGrade, variety: r.byVariety, manager: r.byManager, flower: r.byFlower }}
        gradeLabel={gradeLabel}
        oneFlower={!!flower}
        hasPrev={hasPrev}
      />

      {r.matrix && r.matrix.rows.length > 0 && (
        <Section tone="sales" icon="list" flush title={`Менеджеры × ${gradeLabel.toLowerCase()}, штук`}>
          <div className="table-scroll border-t border-line-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2.5 font-medium">Менеджер</th>
                  {r.matrix.grades.map((g) => (
                    <th key={g} className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                      {formatGrade(g)}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium text-right">Всего</th>
                </tr>
              </thead>
              <tbody>
                {r.matrix.rows.map((row) => (
                  <tr
                    key={row.key}
                    className={clsx("border-b border-line-hairline/70", row.aside && "text-ink-secondary bg-surface-plane/60")}
                  >
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {row.label}
                      {row.key === POINT_ROW_KEY && <span className="ml-1 text-[11px] font-normal text-ink-muted">(не продажа)</span>}
                    </td>
                    {r.matrix!.grades.map((g) => (
                      <td key={g} className="px-3 py-2 text-right tabular-nums">
                        {row.cells[g] ? nf(row.cells[g]) : ""}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{nf(row.total)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-4 py-2.5">Итого продажи</td>
                  {r.matrix.grades.map((g) => (
                    <td key={g} className="px-3 py-2.5 text-right tabular-nums">
                      {r.matrix!.totals[g] ? nf(r.matrix!.totals[g]) : ""}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums">{nf(t.stems)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function Stat({
  title,
  value,
  note,
  now,
  before,
  hasPrev,
}: {
  title: string;
  value: string;
  note?: string;
  now: number;
  before: number;
  hasPrev: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-secondary">{title}</dt>
      <dd className="font-display text-xl font-extrabold tabular-nums">{value}</dd>
      <dd className="text-xs text-ink-muted">
        {hasPrev && (
          <>
            <Change now={now} before={before} />
            {note ? " · " : ""}
          </>
        )}
        {note}
      </dd>
    </div>
  );
}
