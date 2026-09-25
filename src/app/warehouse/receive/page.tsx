import { getServerSession } from "next-auth";
import BatchReceiveForm from "@/components/BatchReceiveForm";
import BatchImportForm from "@/components/BatchImportForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { authOptions } from "@/lib/auth";
import { farmLabel, flowerTypesForFarm } from "@/lib/constants";

import PageHeader from "@/components/PageHeader";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const varieties = await listVarietiesByType();
  // Зав. складом принимает только цветок своего производства.
  const allowedTypes = flowerTypesForFarm(farm);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        area="stock"
        title={`Приёмка с производства${farm ? ` · ${farmLabel(farm)}` : ""}`}
        icon="upload"
        tabs={WAREHOUSE_TABS}
      />

      <BatchImportForm />

      <div>
        <h2 className="font-medium mb-2">Одна партия вручную</h2>
        <BatchReceiveForm varieties={varieties} allowedTypes={allowedTypes} />
      </div>
    </div>
  );
}
