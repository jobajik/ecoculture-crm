import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { PAYROLL_NO_ACCESS } from "@/lib/payroll/access";
import { payrollSession } from "@/lib/payroll/session";

export const dynamic = "force-dynamic";

/**
 * Вход в раздел «Зарплата»: кому можно — сразу к сотрудникам; кому нет — объяснение, а не пустой экран.
 * Роль CRM `payroll` («только зарплата») попадает сюда с главной, поэтому отказ здесь обязан быть внятным.
 */
export default async function PayrollPage() {
  const { scope } = await payrollSession();
  if (scope) redirect("/payroll/employees");
  return (
    <div className="space-y-5">
      <PageHeader area="payroll" title="Зарплата" />
      <div className="card max-w-xl text-sm text-ink-secondary">{PAYROLL_NO_ACCESS}</div>
    </div>
  );
}
