import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditFinance } from "@/lib/financeAccess";
import { brokenKaspiFarms } from "@/lib/kaspiHealthCheck";
import { formatMoment } from "@/lib/formatDate";

/**
 * Красная полоса «Kaspi-касса отключилась» — бухгалтеру и админу, на всех
 * страницах «Оплат» и на главной. Пока касса не работает, счета в Kaspi не
 * уходят, и без полосы это узнавали от клиентов.
 *
 * Серверный компонент: спрашивает ApiPay (с памятью, `kaspiHealthCheck.ts`).
 * Ставится внутри `<Suspense>`, чтобы медленный ApiPay не держал страницу.
 */
export default async function KaspiAlert() {
  const session = await getServerSession(authOptions);
  if (!canEditFinance(session?.user?.role)) return null;
  const broken = await brokenKaspiFarms();
  if (broken.length === 0) return null;

  return (
    <div role="alert" className="rounded-xl border border-status-critical/40 bg-status-critical/[0.07] px-4 py-3 space-y-1.5">
      {broken.map((h) => (
        <div key={h.farm} className="space-y-1">
          <div className="font-semibold text-status-critical">
            Kaspi-касса {h.label} отключилась
            {h.since ? <span className="font-normal text-ink-secondary"> · с {formatMoment(h.since)}</span> : null}
          </div>
          <p className="text-sm text-ink-primary">
            {h.reason}. Счета в Kaspi сейчас не уходят.
            {h.holding && (
              <> ApiPay придерживает новые счета{h.holdingSince ? ` с ${formatMoment(h.holdingSince)}` : ""} и отправит их после переподключения.</>
            )}
          </p>
        </div>
      ))}
      <p className="text-sm text-ink-secondary">
        <b>Что сделать:</b> в кабинете ApiPay переподключите кассира по SMS. Под номером кассира в приложение
        Kaspi Pay не заходить — иначе вылетит снова. Пока касса отключена, оплату вносите вручную.
      </p>
    </div>
  );
}
