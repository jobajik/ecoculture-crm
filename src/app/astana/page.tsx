import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { listStockMoves } from "@/lib/repo/stockMoves";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { ASTANA_STORE, inStore } from "@/lib/officeStore";
import { FLOWER_TYPE_LABELS, formatGrade, gradeColumnLabelFor } from "@/lib/constants";
import { formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import OfficeStockTable, { type OfficeStockRow } from "@/components/OfficeStockTable";
import Hint from "@/components/Hint";
import { astanaTabsFor } from "./tabs";
import { astanaAccess } from "./access";

export const dynamic = "force-dynamic";

/**
 * Склад Астаны (02.11.2026): что лежит в Астане. Приходит отгрузкой «объёма на город» с основного склада (фура),
 * уходит заявками клиентов Астаны (их отгружает менеджер Астаны) и списанием.
 */
export default async function AstanaPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const access = astanaAccess(role, session?.user?.store);
  if (!access.view) {
    return (
      <div>
        <PageHeader area="stock" title="Склад Астаны" icon="store" />
        <p className="card text-sm text-ink-secondary">Склад Астаны ведёт менеджер Астаны — у вас этого склада нет.</p>
      </div>
    );
  }
  const [batches, settings, moves] = await Promise.all([listBatches(), getSettings(), listStockMoves()]);
  const here = inStore(batches, ASTANA_STORE).filter((b) => b.quantityRemaining > 0);
  const infos = here.map((b) => computeBatchStorageInfo(b, settings));

  const rows = new Map<string, { flowerType: string; variety: string; grade: string; qty: number; oldest: number; status: string }>();
  for (const i of infos) {
    const k = `${i.batch.flowerType}|${i.batch.variety.trim().toLowerCase()}|${i.batch.grade.trim().toLowerCase()}`;
    const r = rows.get(k) ?? { flowerType: i.batch.flowerType, variety: i.batch.variety, grade: i.batch.grade, qty: 0, oldest: 0, status: "ok" };
    r.qty += i.batch.quantityRemaining;
    if (i.daysInStorage >= r.oldest) {
      r.oldest = i.daysInStorage;
      r.status = i.status;
    }
    rows.set(k, r);
  }
  const ORDER = ["chrysanthemum", "rose", "eustoma"];
  const list = Array.from(rows.values()).sort(
    (a, b) => ORDER.indexOf(a.flowerType) - ORDER.indexOf(b.flowerType) || a.variety.localeCompare(b.variety, "ru")
  );
  const total = list.reduce((s, r) => s + r.qty, 0);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const stemsBy = (st: string) => infos.filter((i) => i.status === st).reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const critical = stemsBy("critical");
  const arrivals = moves.filter((m) => m.direction === "to_region" && here.concat(inStore(batches, ASTANA_STORE)).some((b) => b.batchId === m.toBatchId));
  const lastArrival = arrivals[0];
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const arrived14 = arrivals.filter((m) => m.createdAt >= since).reduce((s, m) => s + m.quantity, 0);
  const rowsForTable: OfficeStockRow[] = list.map((r) => ({
    key: `${r.flowerType}|${r.variety}|${r.grade}`,
    flowerType: r.flowerType,
    flower: FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType,
    variety: r.variety,
    grade: r.grade,
    gradeLabel: formatGrade(r.grade),
    qty: r.qty,
    oldest: r.oldest,
    status: r.status,
  }));

  return (
    <div>
      <PageHeader
        area="stock"
        title="Склад Астаны"
        subtitle="Приходит фурой — отгрузкой «объёма на город»"
        icon="store"
        tabs={astanaTabsFor(role)}
        actions={
          <div className="flex gap-2">
            {access.keeper && (
              <Link href="/astana/writeoff?mode=recount" className="btn-secondary">
                Пересчёт
              </Link>
            )}
            <Link href="/astana/ship" className="btn-primary">
              Отгрузка
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="box" label="В Астане" value={nf(total)} hint="стеблей" />
        <KpiTile icon="list" label="Позиций" value={nf(list.length)} hint={`в ${nf(here.length)} парт.`} />
        <KpiTile icon="truck" label="Пришло за 14 дней" value={nf(arrived14)} hint={lastArrival ? `последняя фура — ${formatMoment(lastArrival.createdAt)}` : "фур ещё не было"} />
        <KpiTile icon="alert" label="Дольше срока" value={nf(critical)} hint={critical > 0 ? "стеблей — продать или списать" : "нет"} tone={critical > 0 ? "bad" : "good"} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          <span className="py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold">
            Что лежит в Астане <span className="tabular-nums text-ink-muted">{list.length}</span>
          </span>
          <span className="ml-auto py-3">
            <Hint>
              Цветок приходит сюда, когда склад отгружает заявку «объём на город» с направлением Астана — ровно отгруженное
              количество. Отсюда отгружаются заявки «Склад: Астана»: их ставит бот или помощник для клиентов Астаны, пока
              здесь есть нужная позиция, или менеджер вручную.
            </Hint>
          </span>
        </div>
        <OfficeStockTable
          rows={rowsForTable}
          gradeHeader={gradeColumnLabelFor(list.map((r) => r.flowerType))}
          emptyText="В Астане пока пусто — цветок придёт с отгрузкой «объёма на город»."
        />
      </div>
    </div>
  );
}
