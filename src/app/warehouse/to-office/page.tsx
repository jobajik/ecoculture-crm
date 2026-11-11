import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listBatches } from "@/lib/repo/batches";
import { farmLabel } from "@/lib/constants";
import { stockPositions } from "@/lib/writeoffPlan";
import { inStore } from "@/lib/officeStore";
import PageHeader from "@/components/PageHeader";
import StockMoveForm from "@/components/StockMoveForm";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * «В офис» (09.11.2026): зав. складом отдаёт цветок своего производства на подсклад «Офис» — Разия в субботу отправила
 * в офис хризантему и эустому для продажи по городу, а записать это в CRM было негде (перемещал только РОП, `/office`).
 * Та же форма, что у РОПа, но только свои позиции. С 11.11.2026 (РОП ушёл) здесь же «Офис → Склад»: зав. складом
 * возвращает свой цветок из офиса сама (`moveRefusal`).
 */
export default async function ToOfficePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const batches = await listBatches();
  const main = stockPositions(inStore(batches, ""), farm);
  const office = stockPositions(inStore(batches, "office"), farm);
  return (
    <div>
      <PageHeader
        area="stock"
        title={`Офис: отдать и вернуть${farm ? ` · ${farmLabel(farm)}` : ""}`}
        subtitle="Отдать свой цветок на подсклад «Офис» для продажи по городу или вернуть его обратно на основной склад. Снимается с самых старых партий."
        icon="box"
        tabs={WAREHOUSE_TABS}
      />
      <div className="card !p-0 overflow-hidden">
        <StockMoveForm main={main} office={office} />
      </div>
    </div>
  );
}
