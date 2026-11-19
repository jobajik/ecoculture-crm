/**
 * Разбудить отправку накладных (`/api/waybill/run`) своей функцией — действие склада её не ждёт.
 *
 * На Vercel запрос, брошенный без ожидания, может не успеть уйти: функцию замораживают сразу после ответа. Поэтому
 * отдаём его `waitUntil` площадки (тот же, что в `@vercel/functions`, взят напрямую — без новой зависимости); нет его
 * (свой сервер, проверочная копия) — ждём сами, но не дольше полутора секунд: дальше работа идёт в той функции.
 */
export async function kickWaybills(origin: string, orderId = ""): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  const call = fetch(`${origin.replace(/\/+$/, "")}/api/waybill/run${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(1500),
  }).then(
    () => undefined,
    () => undefined // оборвали сами — отправка идёт своей функцией
  );
  const ctx = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
  if (ctx?.waitUntil) ctx.waitUntil(call);
  else await call;
}

export const siteOrigin = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");
