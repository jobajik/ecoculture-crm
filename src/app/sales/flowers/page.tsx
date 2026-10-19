import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { prefetchTables } from "@/lib/sheets";
import {
  SHEET_TABS,
  gradeColumnLabel,
  gradeColumnLabelFor,
  isValidPeriod,
  periodLabel,
  periodOf,
} from "@/lib/constants";
import { buildFlowerSales } from "@/lib/flowerSales";
import { canOpen } from "@/lib/access";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import Change from "@/components/Change";
import FlowerSalesBreakdown from "@/components/FlowerSalesBreakdown";
import { salesTabsFor } from "../tabs";
import { withBotName } from "@/lib/botIdentity";

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
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email])));

  const r = buildFlowerSales({ orders, period, flower, nameByEmail });
  const t = r.totals;
  const p = r.prevTotals;
  const hasPrev = p.stems > 0;
  const prevName = periodLabel(r.prevPeriod).split(" ")[0].toLowerCase();
  const gradeLabel = flower ? gradeColumnLabel(flower) : gradeColumnLabelFor(FLOWERS);

  const prevHint = (now: number, before: number, ok: boolean, note?: string) => (
    <>
      {hasPrev && ok ? (
        <>
          <Change now={now} before={before} /> <span className="text-ink-muted">к {prevName}</span>
        </>
      ) : null}
      {note ? (hasPrev && ok ? ` · ${note}` : note) : null}
    </>
  );

  return (
    <div>
      <PageHeader
        area="sales"
        title="Продажи по цветам"
        icon="leaf"
        tabs={salesTabsFor(role)}
        actions={
          <div className="flex items-center gap-2">
            <PeriodPicker period={period} />
            <Hint>
              Месяц — по дню оформления заявки, как в рейтинге. Отменённые заявки, наши магазины, опт на город и точка
              на базаре не считаются: это не продажа клиенту. Точка на базаре показана отдельной строкой у менеджеров —
              для справки. «Средняя цена» — сумма по позициям, делённая на штуки.
              {hasPrev ? ` Сравнение — с месяцем «${prevName}».` : ` За ${prevName} продаж нет — сравнивать не с чем.`}
            </Hint>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="leaf" label="Продано штук" value={nf(t.stems)} hint={prevHint(t.stems, p.stems, true)} />
        <KpiTile icon="wallet" label="На сумму" value={money(t.amount)} hint={prevHint(t.amount, p.amount, true)} />
        <KpiTile
          icon="tag"
          label="Средняя цена стебля"
          value={t.stems > 0 ? money(t.amount / t.stems) : "—"}
          hint={prevHint(t.stems > 0 ? t.amount / t.stems : 0, p.stems > 0 ? p.amount / p.stems : 0, t.stems > 0)}
        />
        <KpiTile icon="order" label="Заявок" value={nf(t.orders)} hint={prevHint(t.orders, p.orders, true, `клиентов: ${nf(t.clients)}`)} />
      </div>

      <FlowerSalesBreakdown
        rows={{ grade: r.byGrade, variety: r.byVariety, manager: r.byManager, flower: r.byFlower }}
        gradeLabel={gradeLabel}
        oneFlower={!!flower}
        hasPrev={hasPrev}
        matrix={r.matrix}
        flower={flower}
        period={period}
      />
    </div>
  );
}
