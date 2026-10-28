import Link from "next/link";
import clsx from "clsx";
import PageHeader from "@/components/PageHeader";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import { PAYROLL_NO_ACCESS, seesDepartment } from "@/lib/payroll/access";
import { computeMonth, loadPayslipMonth } from "@/lib/payroll/payslipData";
import { payrollSession } from "@/lib/payroll/session";
import { TIMESHEET_STATUS_LABELS, monthLabel, shiftMonth } from "@/lib/payroll/timesheet";
import { localDayKey } from "@/lib/timezone";
import { redirect } from "next/navigation";
import { payrollTabsFor } from "./tabs";

export const dynamic = "force-dynamic";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const TONE: Record<string, string> = {
  approved: "bg-status-good/10 text-status-good",
  submitted: "bg-[#fff4d6] text-[#8a5a00]",
  returned: "bg-[#fde8e8] text-[#a12b2b]",
  "": "bg-surface-sunk text-ink-secondary",
};

/**
 * «Зарплата → Обзор» — где мы по месяцу (28.10.2026, владелец: «сделай удобную, понятную и читаемую систему по
 * зарплате… логично имплементировать все эти процессы»). Три шага одной страницей: люди и ставки → табели по
 * подразделениям (кто сдал, кто нет) → ведомость (к выплате). Каждая плитка ведёт туда, где это делается.
 * Начальник подразделения сюда не попадает — у него только свой табель; без доступа — объяснение, а не пустой экран.
 */
export default async function PayrollPage({ searchParams }: { searchParams?: { month?: string; farm?: string } }) {
  const { scope } = await payrollSession();
  if (!scope) {
    return (
      <div className="space-y-5">
        <PageHeader area="payroll" title="Зарплата" />
        <div className="card max-w-xl text-sm text-ink-secondary">{PAYROLL_NO_ACCESS}</div>
      </div>
    );
  }
  if (!scope.seesMoney) redirect("/payroll/timesheet");
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month ?? "") ? searchParams!.month! : localDayKey().slice(0, 7);
  const farm = FARM_ORDER.includes(searchParams?.farm ?? "") ? searchParams!.farm! : searchParams?.farm === "all" ? "" : FARM_ORDER[0];
  const href = (m: string, f: string) => `/payroll?month=${m}&farm=${f || "all"}`;

  const data = await loadPayslipMonth(month, farm, (d) => seesDepartment(scope, d.deptId));
  const { depts, totals } = computeMonth(data);
  const people = depts.reduce((s, d) => s + d.rows.length, 0);
  const noRate = depts.flatMap((d) => d.rows).filter((r) => r.warnings.includes("нет ставки")).length;
  const emptySheets = depts.flatMap((d) => d.rows).filter((r) => r.warnings.includes("табель пустой")).length;
  const approved = depts.filter((d) => d.timesheetStatus === "approved").length;
  const submitted = depts.filter((d) => d.timesheetStatus === "submitted").length;
  const warnings = depts.flatMap((d) => d.rows).filter((r) => r.warnings.length).length;

  return (
    <div className="space-y-5">
      <PageHeader
        area="payroll"
        title="Зарплата"
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
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Step
          n={1}
          title="Сотрудники и ставки"
          href="/payroll/employees"
          value={`${people} чел.`}
          lines={[noRate ? `без ставки: ${noRate}` : "ставки у всех", "кадровик ведёт карточки, бухгалтер — оклады"]}
          tone={noRate ? "warn" : "ok"}
          action="Открыть штат"
        />
        <Step
          n={2}
          title="Табели по подразделениям"
          href={`/payroll/timesheet?month=${month}`}
          value={`${approved} из ${depts.length} принято`}
          lines={[submitted ? `на проверке: ${submitted}` : "на проверке нет", emptySheets ? `без единой отметки: ${emptySheets} чел.` : "у всех есть часы"]}
          tone={approved === depts.length && depts.length > 0 ? "ok" : "warn"}
          action="К табелям"
        />
        <Step
          n={3}
          title="Расчётная ведомость"
          href={`/payroll/payslip?month=${month}&farm=${farm || "all"}`}
          value={money(totals.toPay)}
          lines={[`начислено ${money(totals.accrued)} · удержано ${money(totals.advance + totals.loan + totals.flowers)}`, warnings ? `не посчитано до конца: ${warnings} чел.` : "посчитано у всех"]}
          tone={warnings ? "warn" : "ok"}
          action="Открыть ведомость"
        />
      </div>

      <section className="card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line-hairline font-display font-bold">По подразделениям</div>
        {depts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-secondary">Подразделений этой компании пока нет — заведите их или загрузите штатную расстановку.</div>
        ) : (
          <div className="divide-y divide-line-hairline">
            {depts.map((d) => {
              const warn = d.rows.filter((r) => r.warnings.length).length;
              return (
                <div key={d.department.deptId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-medium">{d.department.name}</div>
                    <div className="text-xs text-ink-muted">
                      {d.rows.length} чел.
                      {warn > 0 && <span className="text-[#8a5a00]"> · ⚠ {warn}</span>}
                    </div>
                  </div>
                  <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[d.timesheetStatus])}>табель: {TIMESHEET_STATUS_LABELS[d.timesheetStatus]}</span>
                  <span className="tabular-nums text-ink-secondary w-[9rem] text-right hidden sm:inline">{d.totals.factHours.toLocaleString("ru-RU")} ч</span>
                  <span className="tabular-nums w-[9rem] text-right font-medium">{money(d.totals.toPay)}</span>
                  <span className="flex gap-3">
                    <Link className="text-section-payroll hover:underline" href={`/payroll/timesheet/${d.department.deptId}?month=${month}`}>
                      табель
                    </Link>
                    <Link className="text-section-payroll hover:underline" href={`/payroll/payslip?month=${month}&farm=${farm || "all"}`}>
                      ведомость
                    </Link>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Step({ n, title, href, value, lines, tone, action }: { n: number; title: string; href: string; value: string; lines: string[]; tone: "ok" | "warn"; action: string }) {
  return (
    <Link href={href} className="card !p-4 hover:shadow-card-hover transition-shadow block">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span className={clsx("h-5 w-5 rounded-full text-[11px] font-bold flex items-center justify-center", tone === "ok" ? "bg-status-good/10 text-status-good" : "bg-[#fff4d6] text-[#8a5a00]")}>{n}</span>
        {title}
      </div>
      <div className="font-display text-2xl font-extrabold tracking-tight mt-1 tabular-nums">{value}</div>
      {lines.map((l, i) => (
        <div key={i} className={clsx("text-xs mt-0.5", i === 0 && tone === "warn" ? "text-[#8a5a00]" : "text-ink-secondary")}>
          {l}
        </div>
      ))}
      <div className="mt-2 text-sm text-section-payroll">{action} →</div>
    </Link>
  );
}
