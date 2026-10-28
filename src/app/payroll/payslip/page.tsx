import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PayslipBoard from "@/components/payroll/PayslipBoard";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import { seesDepartment } from "@/lib/payroll/access";
import { adjustmentRefusal } from "@/lib/payroll/payslip";
import { loadPayslipMonth } from "@/lib/payroll/payslipData";
import { payrollSession } from "@/lib/payroll/session";
import { monthLabel, shiftMonth } from "@/lib/payroll/timesheet";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../tabs";
import { saveAdjustmentsAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Расчётная ведомость за месяц — замена листа «Расчётная ведомость» гугл-книги. Видят те, кому открыты деньги
 * (бухгалтер, кадровик, агроном, админ); правит бухгалтер и админ. Начальник подразделения сюда не попадает — у него
 * табель. Компания — переключателем, по умолчанию первая.
 */
export default async function PayslipPage({ searchParams }: { searchParams?: { month?: string; farm?: string } }) {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  if (!scope.seesMoney) redirect("/payroll/timesheet");
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month ?? "") ? searchParams!.month! : localDayKey().slice(0, 7);
  const farm = FARM_ORDER.includes(searchParams?.farm ?? "") ? searchParams!.farm! : searchParams?.farm === "all" ? "" : FARM_ORDER[0];
  const data = await loadPayslipMonth(month, farm, (d) => seesDepartment(scope, d.deptId));
  const canEdit = !adjustmentRefusal(scope);
  const href = (m: string, f: string) => `/payroll/payslip?month=${m}&farm=${f || "all"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        area="payroll"
        title="Ведомость"
        subtitle={`${monthLabel(month)} · ${farm ? FARM_LABELS[farm] ?? farm : "обе компании"}`}
        icon="wallet"
        tabs={payrollTabsFor(scope)}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex rounded-lg border border-line-hairline overflow-hidden">
              {[...FARM_ORDER, ""].map((f) => (
                <Link key={f || "all"} href={href(month, f)} className={`px-3 py-1.5 ${f === farm ? "bg-ink-primary text-white" : "hover:bg-surface-sunk"}`}>
                  {f ? FARM_LABELS[f] ?? f : "Обе"}
                </Link>
              ))}
            </div>
            <Link className="btn !py-1.5" href={href(shiftMonth(month, -1), farm)}>
              ‹
            </Link>
            <span className="font-medium min-w-[8.5rem] text-center">{monthLabel(month)}</span>
            <Link className="btn !py-1.5" href={href(shiftMonth(month, 1), farm)}>
              ›
            </Link>
            <a className="btn !py-1.5" href={`/api/payroll/payslip?month=${month}&farm=${farm || "all"}`}>
              Excel
            </a>
          </div>
        }
      />
      {data.depts.length === 0 ? (
        <div className="card text-sm text-ink-secondary">Подразделений этой компании пока нет — заведите их или загрузите штатную расстановку.</div>
      ) : (
        <PayslipBoard key={`${month}-${farm}`} data={data} canEdit={canEdit} save={saveAdjustmentsAction} />
      )}
    </div>
  );
}
