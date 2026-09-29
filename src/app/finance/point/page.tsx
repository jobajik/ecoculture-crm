import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FLOWER_TYPES, FLOWER_TYPE_LABELS, SHEET_TABS, periodLabel, periodOf, periodShift } from "@/lib/constants";
import { prefetchTables } from "@/lib/sheets";
import { localDayKey } from "@/lib/timezone";
import { formatDay } from "@/lib/formatDate";
import { canSeeFinance } from "@/lib/financeAccess";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listPointDays, listPointWriteoffs } from "@/lib/repo/point";
import { POINT_NAME, canEditPoint, pointReport, pointTransfers, transferDay, transferLines } from "@/lib/point";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import PointDayForm from "@/components/PointDayForm";
import PointWriteoffForm from "@/components/PointWriteoffForm";
import PointWriteoffRemove from "@/components/PointWriteoffRemove";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

/**
 * «Оплаты → Точка на базаре». Товар туда ПЕРЕМЕЩАЕТСЯ обычными заявками с
 * направлением «Пожарка», выручку бухгалтер вносит отчётом за день, списания
 * на точке — здесь же. Правила — `src/lib/point.ts`.
 */
export default async function PointPage({ searchParams }: { searchParams?: { month?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeFinance(role)) redirect("/?error=forbidden");

  const current = periodOf(new Date());
  const month = searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : current;
  const today = localDayKey();

  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.POINT_SALES, SHEET_TABS.POINT_WRITEOFFS]);
  const [orders, days, writeoffs] = await Promise.all([listOrdersWithItems(), listPointDays(), listPointWriteoffs()]);
  const report = pointReport({ orders, days, writeoffs, month, today });
  const editable = canEditPoint(role);
  const known = Object.fromEntries(days.map((d) => [d.date, { kaspi: d.kaspi, cash: d.cash, note: d.note }]));
  const transfers = pointTransfers(orders)
    .filter((o) => transferDay(o).slice(0, 7) === month)
    .sort((a, b) => (transferDay(a) < transferDay(b) ? 1 : -1));
  const monthWriteoffs = writeoffs.filter((w) => w.date.slice(0, 7) === month).sort((a, b) => (a.date < b.date ? 1 : -1));

  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));

  const tiles = [
    { label: "Отвезли", value: money(report.transferred.amount), hint: `${n(report.transferred.stems)} шт.` },
    {
      label: "Выручка",
      value: money(report.revenue.total),
      hint: `Kaspi ${money(report.revenue.kaspi)} · нал. ${money(report.revenue.cash)}${report.revenue.fromOrders > 0 ? ` · по заявкам ${money(report.revenue.fromOrders)}` : ""}`,
    },
    { label: "Списано на точке", value: money(report.writeoffs.amount), hint: `${n(report.writeoffs.stems)} шт.` },
    { label: "Продано от отвезённого", value: `${report.sellThrough} %`, hint: "выручка ÷ отвезли за месяц" },
    { label: "На точке сейчас, примерно", value: money(report.onPoint), hint: "всё отвезённое − выручка − списания" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader area="money" title={POINT_NAME} icon="store" tabs={financeTabsFor(role)} />

      <div className="flex flex-wrap gap-2">
        {months.map((m) => (
          <Link
            key={m}
            href={`/finance/point?month=${m}`}
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="card !py-3">
            <div className="text-xs text-ink-secondary">{t.label}</div>
            <div className="font-display text-xl font-extrabold tabular-nums">{t.value}</div>
            <div className="text-xs text-ink-muted">{t.hint}</div>
          </div>
        ))}
      </div>

      {editable && (
        <Section
          tone="money"
          icon="wallet"
          title={
            <>
              Выручка за день{" "}
              <Hint>
                Сколько точка приняла за день: на Kaspi (счета они выставляют сами) и наличными. Это и есть продажа —
                сама заявка «Пожарка» только перемещает товар. Один день — одна запись: внесёте день ещё раз, запись
                заменится.
              </Hint>
            </>
          }
        >
          <PointDayForm today={today} known={known} />
        </Section>
      )}

      <Section tone="money" icon="calendar" title="По дням" flush>
        {report.days.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">За этот месяц ничего не было.</p>
        ) : (
          <div className="table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-3 py-2.5 font-medium">День</th>
                  <th className="px-3 py-2.5 font-medium text-right">Отвезли</th>
                  <th className="px-3 py-2.5 font-medium text-right">Kaspi</th>
                  <th className="px-3 py-2.5 font-medium text-right">Наличные</th>
                  <th className="px-3 py-2.5 font-medium text-right">Выручка</th>
                  <th className="px-3 py-2.5 font-medium text-right">Списано</th>
                  <th className="px-3 py-2.5 font-medium">Заметка</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => {
                  const rev = d.kaspi + d.cash + d.fromOrders;
                  return (
                    <tr key={d.date} className="border-b border-line-hairline last:border-0">
                      <td className="px-3 py-2">{formatDay(d.date)}</td>
                      <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Отвезли">
                        {d.transferred ? money(d.transferred) : "—"}
                      </td>
                      <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Kaspi">
                        {d.kaspi ? money(d.kaspi) : "—"}
                      </td>
                      <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Наличные">
                        {d.cash ? money(d.cash) : "—"}
                      </td>
                      <td className="px-3 py-2 sm:text-right tabular-nums font-medium" data-label="Выручка">
                        {rev ? money(rev) : "—"}
                        {d.fromOrders > 0 && <div className="text-xs text-ink-muted">в т.ч. по заявкам {money(d.fromOrders)}</div>}
                      </td>
                      <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Списано">
                        {d.writeoff ? money(d.writeoff) : "—"}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary" data-label="Заметка">
                        {d.note}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section tone="stock" icon="leaf" title="По цветкам" flush>
        {report.flowers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">В этом месяце на точку не возили.</p>
        ) : (
          <div className="table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-3 py-2.5 font-medium">Цветок</th>
                  <th className="px-3 py-2.5 font-medium text-right">Отвезли, шт.</th>
                  <th className="px-3 py-2.5 font-medium text-right">На сумму</th>
                  <th className="px-3 py-2.5 font-medium text-right">Списано, шт.</th>
                  <th className="px-3 py-2.5 font-medium text-right">На сумму</th>
                </tr>
              </thead>
              <tbody>
                {report.flowers.map((f) => (
                  <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                    <td className="px-3 py-2">{f.label}</td>
                    <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Отвезли, шт.">{n(f.stems)}</td>
                    <td className="px-3 py-2 sm:text-right tabular-nums" data-label="На сумму">{money(f.amount)}</td>
                    <td className="px-3 py-2 sm:text-right tabular-nums" data-label="Списано, шт.">{f.writeoffStems ? n(f.writeoffStems) : "—"}</td>
                    <td className="px-3 py-2 sm:text-right tabular-nums" data-label="На сумму">{f.writeoffAmount ? money(f.writeoffAmount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        tone="warn"
        icon="alert"
        title={
          <>
            Списания на точке{" "}
            <Hint>Завяло, сломалось, не продалось. Сумма — по средней цене, по которой этот цветок возили на точку.</Hint>
          </>
        }
      >
        {editable && (
          <div className="mb-4">
            <PointWriteoffForm
              today={today}
              flowers={[FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.ROSE, FLOWER_TYPES.EUSTOMA].map((f) => ({ value: f, label: FLOWER_TYPE_LABELS[f] }))}
            />
          </div>
        )}
        {monthWriteoffs.length === 0 ? (
          <p className="text-sm text-ink-muted">В этом месяце списаний нет.</p>
        ) : (
          <ul className="divide-y divide-line-hairline text-sm">
            {monthWriteoffs.map((w) => (
              <li key={w.writeoffId} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="w-24 text-ink-secondary">{formatDay(w.date)}</span>
                <span className="flex-1 min-w-0">
                  {FLOWER_TYPE_LABELS[w.flowerType] ?? w.flowerType} · {n(w.quantity)} шт. · {money(w.amount)}
                  <span className="text-ink-muted"> · {w.reason}</span>
                </span>
                {editable && <PointWriteoffRemove writeoffId={w.writeoffId} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section tone="order" icon="truck" title={`Перемещения за месяц: ${transfers.length}`} flush>
        {transfers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            Заявок на точку не было. Менеджер оформляет обычную заявку и ставит направление «Пожарка».
          </p>
        ) : (
          <ul className="divide-y divide-line-hairline text-sm">
            {transfers.map((o) => {
              const lines = transferLines(o);
              const amount = lines.reduce((s, l) => s + l.amount, 0);
              const ordered = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
              return (
                <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                  <Link href={`/orders/${o.orderId}`} className="text-series-1">
                    {formatDay(transferDay(o))} · {o.clientName}
                  </Link>
                  <span className="tabular-nums text-ink-secondary">
                    {amount > 0 ? `отвезено на ${money(amount)}` : `ещё не отгружено (заявка на ${money(ordered)})`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
