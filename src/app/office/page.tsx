import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { stockPositions } from "@/lib/writeoffPlan";
import { canMoveStock, inStore } from "@/lib/officeStore";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import Hint from "@/components/Hint";
import StockMoveForm from "@/components/StockMoveForm";
import { officeTabsFor } from "./tabs";

export const dynamic = "force-dynamic";

/**
 * Подсклад «Офис»: что лежит в офисе и перемещение основной склад ⇄ офис.
 * Перемещает РОП (решение владельца), склад офиса видит остатки и отгружает.
 */
export default async function OfficePage() {
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

  return (
    <div className="max-w-4xl">
      <PageHeader
        area="stock"
        title="Офис"
        subtitle={`В офисе ${nf(total)} шт. · после 12:00 бот продаёт отсюда`}
        icon="store"
        tabs={officeTabsFor(role)}
        actions={
          <Link href="/office/ship" className="btn-primary">
            Отгрузка
          </Link>
        }
      />

      <Section
        tone="stock"
        icon="box"
        title={
          <>
            Что лежит в офисе
            <span className="normal-case tracking-normal">
              <Hint>
                Цветок попадает сюда перемещением с основного склада (его делает РОП). Отсюда отгружаются заявки
                «Склад: Офис» — их ставит бот после 12:00 или менеджер вручную.
              </Hint>
            </span>
          </>
        }
        flush
      >
        <div className="table-scroll table-cards border-t border-line-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2.5 font-medium">Цветок</th>
                <th className="px-3 py-2.5 font-medium">Сорт</th>
                <th className="px-3 py-2.5 font-medium">Категория</th>
                <th className="px-3 py-2.5 font-medium text-right">Шт.</th>
                <th className="px-3 py-2.5 font-medium text-right">Лежит</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.flowerType}|${r.variety}|${r.grade}`} className="border-b border-line-hairline last:border-0">
                  <td className="px-4 py-2">{FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType}</td>
                  <td data-label="Сорт" className="px-3 py-2">{r.variety}</td>
                  <td data-label="Категория" className="px-3 py-2">{formatGrade(r.grade)}</td>
                  <td data-label="Шт." className="px-3 py-2 text-right tabular-nums font-medium">{nf(r.qty)}</td>
                  <td
                    data-label="Лежит"
                    className={
                      "px-3 py-2 text-right whitespace-nowrap " +
                      (r.status === "critical" ? "text-status-critical" : r.status === "warning" ? "text-[#8a5a00]" : "text-ink-secondary")
                    }
                  >
                    {r.oldest} дн.
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                    В офисе пока пусто{mover ? " — переместите цветок со склада ниже." : "."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {mover && (
        <Section tone="stock" icon="route" title="Перемещение">
          <StockMoveForm main={stockPositions(inStore(batches, ""), null)} office={stockPositions(office, null)} />
        </Section>
      )}
    </div>
  );
}
