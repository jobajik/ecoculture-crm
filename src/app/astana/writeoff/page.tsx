import { listBatches } from "@/lib/repo/batches";
import { stockPositions } from "@/lib/writeoffPlan";
import { ASTANA_STORE, inStore } from "@/lib/officeStore";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import WriteoffBulkForm from "@/components/WriteoffBulkForm";
import { astanaTabsFor } from "../tabs";
import { astanaAccess } from "../access";

export const dynamic = "force-dynamic";

/** Списание в Астане — тем же путём, что на основном складе, но только партии склада Астаны. */
export default async function AstanaWriteoffPage({ searchParams }: { searchParams?: { mode?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const access = astanaAccess(role, session?.user?.store);
  const positions = access.keeper ? stockPositions(inStore(await listBatches(), ASTANA_STORE), null) : [];
  return (
    <div>
      <PageHeader area="stock" title="Списание в Астане" subtitle="Снимается с самых старых партий позиции." icon="alert" tabs={astanaTabsFor(role)} />
      {!access.keeper ? (
        <p className="card text-sm text-ink-secondary">Списывает менеджер Астаны.</p>
      ) : (
        <WriteoffBulkForm positions={positions} store={ASTANA_STORE} initialMode={searchParams?.mode === "recount" ? "recount" : "writeoff"} />
      )}
    </div>
  );
}
