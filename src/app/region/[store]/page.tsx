import Link from "next/link";
import { listBatches } from "@/lib/repo/batches";
import { listStockMoves } from "@/lib/repo/stockMoves";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { inStore } from "@/lib/officeStore";
import { FLOWER_TYPE_LABELS, formatGrade, gradeColumnLabelFor } from "@/lib/constants";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { WEEKDAY_FULL } from "@/lib/regionTruck";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import OfficeStockTable, { type OfficeStockRow } from "@/components/OfficeStockTable";
import Hint from "@/components/Hint";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import { loadRegion, loadTruckOrders } from "../load";

export const dynamic = "force-dynamic";

/**
 * Склад города (17.11.2026; до этого — «Склад Астаны», 02.11.2026): что лежит в городе. Приходит ПРИЁМКОЙ фуры — директор
 * подтверждает, сколько приехало по заказу «объём на город»; уходит заявками клиентам со склада города и списанием.
 */
export default async function RegionStockPage({ params }: { params: { store: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const [batches, settings, moves, truck] = await Promise.all([listBatches(), getSettings(), listStockMoves(), loadTruckOrders(r.store, r.today)]);
  const all = inStore(batches, r.store);
  const here = all.filter((b) => b.quantityRemaining > 0);
  const infos = here.map((b) => computeBatchStorageInfo(b, settings));

  const rows = new Map<string, { flowerType: string; variety: string; grade: string; qty: number; oldest: number; status: string }>();
  for (const i of infos) {
    const k = `${i.batch.flowerType}|${i.batch.variety.trim().toLowerCase()}|${i.batch.grade.trim().toLowerCase()}`;
    const row = rows.get(k) ?? { flowerType: i.batch.flowerType, variety: i.batch.variety, grade: i.batch.grade, qty: 0, oldest: 0, status: "ok" };
    row.qty += i.batch.quantityRemaining;
    if (i.daysInStorage >= row.oldest) {
      row.oldest = i.daysInStorage;
      row.status = i.status;
    }
    rows.set(k, row);
  }
  const ORDER = ["chrysanthemum", "chrysanthemum_rf", "rose", "eustoma"];
  const list = Array.from(rows.values()).sort((a, b) => ORDER.indexOf(a.flowerType) - ORDER.indexOf(b.flowerType) || a.variety.localeCompare(b.variety, "ru"));
  const total = list.reduce((s, x) => s + x.qty, 0);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const critical = infos.filter((i) => i.status === "critical").reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const ids = new Set(all.map((b) => b.batchId));
  const arrivals = moves.filter((m) => m.direction === "to_region" && ids.has(m.toBatchId));
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const arrived14 = arrivals.filter((m) => m.createdAt >= since).reduce((s, m) => s + m.quantity, 0);
  const transit = truck.orders.filter((o) => o.stage === "transit");
  const transitStems = transit.reduce((s, o) => s + o.pending, 0);
  const waiting = truck.orders.filter((o) => o.stage === "waiting" || o.stage === "loading");
  const rowsForTable: OfficeStockRow[] = list.map((x) => ({
    key: `${x.flowerType}|${x.variety}|${x.grade}`,
    flowerType: x.flowerType,
    flower: FLOWER_TYPE_LABELS[x.flowerType] ?? x.flowerType,
    variety: x.variety,
    grade: x.grade,
    gradeLabel: formatGrade(x.grade),
    qty: x.qty,
    oldest: x.oldest,
    status: x.status,
  }));
  const people = [...r.seat.directors.map((e) => `директор — ${r.nameOf(e)}`), ...r.seat.managers.map((e) => `менеджер — ${r.nameOf(e)}`)];
  const base = `/region/${r.store}`;

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Склад ${r.info.genitive}`}
        subtitle={`${people.length ? people.join(", ") : "директор не назначен"} · фура — ${WEEKDAY_FULL[r.seat.truckWeekday]}`}
        icon="store"
        tabs={r.headerTabs}
        actions={
          <div className="flex gap-2">
            {r.access.keeper && (
              <Link href={`${base}/writeoff?mode=recount`} className="btn-secondary">
                Пересчёт
              </Link>
            )}
            {r.access.order && (
              <Link href={`${base}/truck/new`} className="btn-primary">
                + Заказ на фуру
              </Link>
            )}
          </div>
        }
      />
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={base} />}

      {transit.length > 0 && (
        <div className="card mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-status-warning/40 bg-status-warning/10">
          <div className="text-sm mr-auto">
            <b className="font-semibold">Фура ждёт приёмки: {nf(transitStems)} шт.</b>{" "}
            <span className="text-ink-secondary">
              Склад отгрузил {transit.length === 1 ? "заказ" : `заказы (${transit.length})`} от {Array.from(new Set(transit.map((o) => formatDay(o.deliveryDate)))).join(", ")}. На остаток города цветок
              ляжет после подтверждения.
            </span>
          </div>
          <Link href={`${base}/truck`} className={r.access.accept ? "btn-primary" : "btn-secondary"}>
            {r.access.accept ? "Принять фуру" : "Посмотреть"}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="box" label="На складе города" value={nf(total)} hint={`стеблей · ${nf(list.length)} поз.`} />
        <KpiTile
          icon="truck"
          label="Едет и ждёт загрузки"
          value={nf(transitStems + waiting.reduce((s, o) => s + (o.ordered - o.shipped), 0))}
          hint={transitStems > 0 ? `${nf(transitStems)} шт. ждут приёмки` : waiting.length > 0 ? `заказов на фуру: ${waiting.length}` : "заказов на фуру нет"}
          tone={transitStems > 0 ? "warn" : undefined}
          href={`${base}/truck`}
        />
        <KpiTile icon="calendar" label="Принято за 14 дней" value={nf(arrived14)} hint={arrivals[0] ? `последний приход — ${formatMoment(arrivals[0].createdAt)}` : "приходов ещё не было"} />
        <KpiTile icon="alert" label="Дольше срока" value={nf(critical)} hint={critical > 0 ? "стеблей — продать или списать" : "нет"} tone={critical > 0 ? "bad" : "good"} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          <span className="py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold">
            Что лежит в городе <span className="tabular-nums text-ink-muted">{list.length}</span>
          </span>
          <span className="ml-auto py-3">
            <Hint>
              Цветок приходит сюда приёмкой фуры: склад отгружает заказ «на опт», директор региона подтверждает, сколько приехало. Отсюда отгружаются заявки
              клиентам города («Склад: {r.info.label}») — их оформляет директор, менеджер города, бот или помощник. Цифры расходятся с полкой — «Пересчёт».
            </Hint>
          </span>
        </div>
        <OfficeStockTable
          rows={rowsForTable}
          gradeHeader={gradeColumnLabelFor(list.map((x) => x.flowerType))}
          emptyText="На складе города пока пусто — цветок появится после приёмки фуры."
        />
      </div>
    </div>
  );
}
