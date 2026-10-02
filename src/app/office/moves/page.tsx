import { listStockMoves } from "@/lib/repo/stockMoves";
import { listUsers } from "@/lib/repo/users";
import { nameIndex, personName } from "@/lib/personName";
import { positionLabel } from "@/lib/writeoffPlan";
import { formatMoment } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Section from "@/components/Section";
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

  return (
    <div className="max-w-4xl">
      <PageHeader
        area="stock"
        title="Перемещения"
        subtitle={`За 30 дней: в офис ${nf(toOffice)} шт., обратно ${nf(back)} шт.`}
        icon="route"
        tabs={officeTabsFor(role)}
      />
      <Section tone="stock" icon="list" title="Журнал" flush>
        <div className="table-scroll table-cards border-t border-line-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2.5 font-medium">Когда</th>
                <th className="px-3 py-2.5 font-medium">Куда</th>
                <th className="px-3 py-2.5 font-medium">Позиция</th>
                <th className="px-3 py-2.5 font-medium text-right">Шт.</th>
                <th className="px-3 py-2.5 font-medium">Кто</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.moveId} className="border-b border-line-hairline last:border-0 align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{formatMoment(m.createdAt)}</td>
                  <td data-label="Куда" className="px-3 py-2 whitespace-nowrap">
                    {m.direction === "to_office" ? "Склад → Офис" : "Офис → Склад"}
                  </td>
                  <td data-label="Позиция" className="px-3 py-2">
                    {positionLabel(m)}
                    {m.note && <div className="text-xs text-ink-muted">{m.note}</div>}
                  </td>
                  <td data-label="Шт." className="px-3 py-2 text-right tabular-nums">{nf(m.quantity)}</td>
                  <td data-label="Кто" className="px-3 py-2 text-ink-secondary">{personName(m.byEmail, names)}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                    Перемещений за 30 дней не было.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
