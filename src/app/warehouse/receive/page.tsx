import Link from "next/link";
import { getServerSession } from "next-auth";
import BatchReceiveForm from "@/components/BatchReceiveForm";
import BatchImportForm from "@/components/BatchImportForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { listBatches } from "@/lib/repo/batches";
import { authOptions } from "@/lib/auth";
import {
  FLOWER_TYPE_LABELS,
  farmLabel,
  flowerTypesForFarm,
  formatGrade,
  getFarmFor,
  gradeColumnLabelFor,
} from "@/lib/constants";
import { localDayKey } from "@/lib/timezone";
import { likelyDuplicates } from "@/lib/batchFix";
import { receivedOn } from "@/lib/receivedToday";

import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const [varieties, batches] = await Promise.all([listVarietiesByType(), listBatches()]);
  // Зав. складом принимает только цветок своего производства.
  const allowedTypes = flowerTypesForFarm(farm);
  // «Сегодня» — по Алматы с сервера, а не по часам браузера (грабли 1.18).
  const today = localDayKey();

  const own = batches.filter((b) => !farm || getFarmFor(b.flowerType) === farm);
  const todayBatches = receivedOn(own, today);
  const duplicates = likelyDuplicates(own);
  const todayTotal = todayBatches.reduce((s, b) => s + b.quantityIn, 0);
  const dupCount = todayBatches.filter((b) => duplicates.has(b.batchId)).length;
  const nf = (n: number) => n.toLocaleString("ru-RU");

  return (
    <div className="space-y-6">
      <PageHeader
        area="stock"
        title={`Приёмка с производства${farm ? ` · ${farmLabel(farm)}` : ""}`}
        icon="upload"
        tabs={WAREHOUSE_TABS}
      />

      <div>
        <h2 className="font-medium mb-2">Одна партия</h2>
        <BatchReceiveForm varieties={varieties} allowedTypes={allowedTypes} today={today} />
      </div>

      <BatchImportForm />

      <Section
        tone="stock"
        icon="list"
        title="Принято сегодня"
        aside={
          todayBatches.length > 0 && (
            <span className="text-sm text-ink-secondary">
              {todayBatches.length} парт. · {nf(todayTotal)} шт.
            </span>
          )
        }
        flush
      >
        {todayBatches.length === 0 ? (
          <p className="pl-5 pr-4 pb-4 text-sm text-ink-muted">Сегодня ещё ничего не принимали.</p>
        ) : (
          <>
            {dupCount > 0 && (
              <p className="ml-5 mr-4 mb-3 text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2">
                Похоже на повтор приёмки: {dupCount}.{" "}
                <Link href="/warehouse/batches" className="underline">
                  Исправить в «Партиях»
                </Link>
              </p>
            )}
            <div className="table-scroll table-cards border-t border-line-hairline">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-secondary border-b border-line-hairline">
                    <th className="px-4 py-2.5 font-medium">Сорт</th>
                    <th className="px-3 py-2.5 font-medium">
                      {gradeColumnLabelFor(todayBatches.map((b) => b.flowerType))}
                    </th>
                    <th className="px-3 py-2.5 font-medium text-right">Шт.</th>
                  </tr>
                </thead>
                <tbody>
                  {todayBatches.map((b) => (
                    <tr key={b.batchId} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2">
                        {FLOWER_TYPE_LABELS[b.flowerType]} {b.variety}
                        {duplicates.has(b.batchId) && (
                          <div className="text-xs font-normal text-[#8a5a00]">похоже на повтор</div>
                        )}
                      </td>
                      <td data-label={gradeColumnLabelFor([b.flowerType])} className="px-3 py-2">
                        {formatGrade(b.grade)}
                      </td>
                      <td data-label="Шт." className="px-3 py-2 text-right tabular-nums font-medium">
                        {nf(b.quantityIn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
