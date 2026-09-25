import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot } from "@/lib/finance";
import { listKaspiInvoices } from "@/lib/repo/kaspiInvoices";
import { configuredFarms } from "@/lib/apipay";
import { prefetchTables } from "@/lib/sheets";
import { SHEET_TABS } from "@/lib/constants";
import { canEditFinance, canSeeFinance } from "@/lib/financeAccess";
import { buildPaymentStatus } from "@/lib/paymentStatus";
import { localDayKey } from "@/lib/timezone";
import PageHeader from "@/components/PageHeader";
import PaymentStatusView from "@/components/PaymentStatusView";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Оплаты → Статус оплат»: где сейчас каждый неоплаченный счёт — Kaspi ждёт,
 * Kaspi не дошёл, нет отметки о счёте, отправлен вручную, оплачен частично — и
 * что пришло сегодня. Правила дорожек — `src/lib/paymentStatus.ts`.
 */
export default async function PaymentStatusPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!canSeeFinance(role)) redirect("/?error=forbidden");

  // Все нужные вкладки — одним запросом к Google (грабли 1.17).
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.USERS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.KASPI_INVOICES,
  ]);
  const [snapshot, invoices] = await Promise.all([getFinanceSnapshot("month"), listKaspiInvoices()]);
  const board = buildPaymentStatus(snapshot.openRows, snapshot.recentPaidRows, invoices, localDayKey());

  return (
    <div className="space-y-5">
      <PageHeader area="money" title="Статус оплат" icon="card" tabs={financeTabsFor(role)} />
      <PaymentStatusView
        board={board}
        canEdit={canEditFinance(role)}
        generatedAt={snapshot.generatedAt}
        kaspiFarms={configuredFarms()}
      />
    </div>
  );
}
