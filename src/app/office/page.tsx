import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { stockPositions } from "@/lib/writeoffPlan";
import { canMoveStock, inStore, isOfficeRole } from "@/lib/officeStore";
import { FLOWER_TYPE_LABELS, formatGrade, gradeColumnLabelFor } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import OfficeStockTable, { type OfficeStockRow } from "@/components/OfficeStockTable";
import Hint from "@/components/Hint";
import StockMoveForm from "@/components/StockMoveForm";
import { officeTabsFor } from "./tabs";

export const dynamic = "force-dynamic";

/**
 * Подсклад «Офис»: что лежит в офисе и перемещение основной склад ⇄ офис.
 * Перемещает РОП (решение владельца), склад офиса видит остатки и отгружает.
 */
export default async function OfficePage({ searchParams }: { searchParams?: { view?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const [batches, settings] = await Promise.all([listBatches(), getSettings()]);
  const office = inStore(batches, "office").filter((b) => b.quantityRemaining > 0);
  const infos = office.map((b) => computeBatchStorageInfo(b, settings));

  // Позиция офиса: сколько всего и сколько дней лежит самое старое.
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
  const ORDER = ["rose", "chrysanthemum", "eustoma"];
  const list = Array.from(rows.values()).sort(
    (a, b) => ORDER.indexOf(a.flowerType) - ORDER.indexOf(b.flowerType) || a.variety.localeCompare(b.variety, "ru")
  );
  const total = list.reduce((s, r) => s + r.qty, 0);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const mover = canMoveStock(role);
  // Пересчёт — у тех, кто списывает в офисе (РОП только смотрит и перемещает).
  const canRecount = isOfficeRole(role) || role === "admin";

  // Новый вид (19.10.2026): цифры сверху, ниже одна карточка — «Что лежит» и «Перемещение» вкладками.
  const view = mover && searchParams?.view === "move" ? "move" : "stock";
  const stemsBy = (st: string) => infos.filter((i) => i.status === st).reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const critical = stemsBy("critical");
  const warning = stemsBy("warning");
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
  const tabCls = (on: boolean) =>
    on
      ? "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-section-stock text-ink-primary font-semibold"
      : "py-3 text-sm border-b-2 -mb-px whitespace-nowrap border-transparent text-ink-secondary hover:text-ink-primary";

  return (
    <div>
      <PageHeader
        area="stock"
        title="Офис"
        subtitle="После 12:00 бот продаёт отсюда"
        icon="store"
        tabs={officeTabsFor(role)}
        actions={
          <div className="flex gap-2">
            {canRecount && (
              <Link href="/office/writeoff?mode=recount" className="btn-secondary">
                Пересчёт
              </Link>
            )}
            <Link href="/office/ship" className="btn-primary">
              Отгрузка
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="box" label="В офисе" value={nf(total)} hint="стеблей" />
        <KpiTile icon="list" label="Позиций" value={nf(list.length)} hint={`в ${nf(office.length)} парт.`} />
        <KpiTile
          icon="alert"
          label="Дольше срока"
          value={nf(critical)}
          hint={critical > 0 ? "стеблей — списать или продать" : "нет"}
          tone={critical > 0 ? "bad" : "good"}
        />
        <KpiTile icon="clock" label="Скоро срок" value={nf(warning)} hint={warning > 0 ? "стеблей" : "нет"} tone={warning > 0 ? "warn" : undefined} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          <Link href="/office" className={tabCls(view === "stock")}>
            Что лежит в офисе <span className="tabular-nums text-ink-muted">{list.length}</span>
          </Link>
          {mover && (
            <Link href="/office?view=move" className={tabCls(view === "move")}>
              Перемещение
            </Link>
          )}
          <span className="ml-auto py-3">
            <Hint>
              Цветок попадает сюда перемещением с основного склада (его делает РОП). Отсюда отгружаются заявки
              «Склад: Офис» — их ставит бот после 12:00 или менеджер вручную.
            </Hint>
          </span>
        </div>
        {view === "stock" ? (
          <OfficeStockTable
            rows={rowsForTable}
            gradeHeader={gradeColumnLabelFor(list.map((r) => r.flowerType))}
            emptyText={`В офисе пока пусто${mover ? " — переместите цветок со склада во вкладке «Перемещение»." : "."}`}
          />
        ) : (
          <StockMoveForm main={stockPositions(inStore(batches, ""), null)} office={stockPositions(office, null)} />
        )}
      </div>
    </div>
  );
}
