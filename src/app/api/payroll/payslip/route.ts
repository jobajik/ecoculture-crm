import { pickPayrollFarm } from "@/lib/payroll/farmScope";
import { seesDepartment } from "@/lib/payroll/access";
import { loadPayslipMonth } from "@/lib/payroll/payslipData";
import { buildPayslipWorkbook } from "@/lib/payroll/payslipExcel";
import { payrollSession } from "@/lib/payroll/session";

export const dynamic = "force-dynamic";

/** Выгрузка расчётной ведомости за месяц в .xlsx — тем же, кому открыта страница «Ведомость». */
export async function GET(request: Request) {
  const { scope } = await payrollSession();
  if (!scope) return new Response("Не авторизован", { status: 401 });
  if (!scope.seesMoney) return new Response("Недостаточно прав", { status: 403 });
  const params = new URL(request.url).searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : "";
  if (!month) return new Response("Непонятный месяц", { status: 400 });
  // Ведомость — всегда одной компании (владелец: «обеих» не бывает).
  const farm = pickPayrollFarm(params.get("farm") ?? "", undefined);
  const data = await loadPayslipMonth(month, farm, (d) => seesDepartment(scope, d.deptId));
  const buffer = await buildPayslipWorkbook(data);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="vedomost-${farm}-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
