import { listStockMoves } from "@/lib/repo/stockMoves";
import { listUsers } from "@/lib/repo/users";
import { nameIndex, personName } from "@/lib/personName";
import { positionLabel } from "@/lib/writeoffPlan";
import { formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import KpiTile from "@/components/KpiTile";
import OfficeMovesTable, { type OfficeMoveRow } from "@/components/OfficeMovesTable";
import { officeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/** Журнал перемещений основной склад ⇄ офис за 30 дней. */
export default async function OfficeMovesPage() {
  const role = (await getServerSession(authOptions))?.user?.role ?? "";
  const [moves, users] = await Promise.all([listStockMoves(), listUsers()]);
  const names = nameIndex(users);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = moves.filter((m) => m.createdAt >= since);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const toOffice = recent.filter((m) => m.direction === "to_office").reduce((s, m) => s + m.quantity, 0);
  const back = recent.filter((m) => m.direction === "to_main").reduce((s, m) => s + m.quantity, 0);

  const rows: OfficeMoveRow[] = recent.map((m) => ({
    id: m.moveId,
    when: formatMoment(m.createdAt),
    toOffice: m.direction === "to_office",
    label: positionLabel(m),
    note: m.note || "",
    quantity: m.quantity,
    who: personName(m.byEmail, names),
  }));

  // Новый вид (19.10.2026): итоги плитками, журнал — одна карточка с отбором и страницами.
  return (
    <div>
      <PageHeader area="stock" title="Перемещения" subtitle="За 30 дней" icon="route" tabs={officeTabsFor(role)} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="route" label="В офис" value={nf(toOffice)} hint="стеблей за 30 дней" />
        <KpiTile icon="arrow" label="Обратно на склад" value={nf(back)} hint="стеблей за 30 дней" />
        <KpiTile icon="list" label="Перемещений" value={nf(recent.length)} hint="записей в журнале" />
        <KpiTile
          icon="box"
          label="Итого в офис"
          value={nf(toOffice - back)}
          hint="перемещено минус вернули"
        />
      </div>
      <OfficeMovesTable rows={rows} />
    </div>
  );
}
