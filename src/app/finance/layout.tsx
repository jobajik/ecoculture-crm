import { Suspense } from "react";
import KaspiAlert from "@/components/KaspiAlert";

/**
 * Над всеми страницами «Оплат» — полоса «Kaspi-касса отключилась» (только
 * бухгалтеру и админу; `KaspiAlert`). В `Suspense`: ApiPay отвечает не
 * мгновенно, и ждать его ради самой страницы нельзя.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <KaspiAlert />
      </Suspense>
      {children}
    </div>
  );
}
