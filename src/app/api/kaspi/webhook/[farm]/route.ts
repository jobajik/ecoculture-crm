import { NextResponse } from "next/server";
import { apiPayConfig, unwrapInvoice, verifyWebhookSignature } from "@/lib/apipay";
import { applyApiPayInvoice } from "@/lib/kaspiSync";

export const dynamic = "force-dynamic";

/**
 * Вебхук ApiPay: `https://www.crm-ecoculture.kz/api/kaspi/webhook/<компания>`
 * (esentai или rose_farm). Адрес и секрет подписи вписываются в кабинете
 * ApiPay (Настройки → Подключение → карточка ключа → «Изменить»).
 *
 * Входа тут нет (ApiPay не залогинен), поэтому доверяем только ПОДПИСИ:
 * HMAC-SHA256 сырого тела секретом этой компании. Без подписи — 401, и ничего
 * не пишется. Незнакомый счёт (тестовый из песочницы, чужой) — 200 без записи:
 * иначе ApiPay будет повторять его бесконечно.
 */
export async function POST(request: Request, { params }: { params: { farm: string } }) {
  const cfg = apiPayConfig(params.farm);
  if (!cfg) return NextResponse.json({ error: "unknown farm" }, { status: 404 });

  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-webhook-signature"), cfg.webhookSecret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const event = String(body.event || "");
  if (event !== "invoice.status_changed" && event !== "invoice.refunded") {
    // webhook.test, invoice.qr_scanned и прочее — принять и ничего не делать.
    return NextResponse.json({ ok: true, ignored: event });
  }
  const inv = unwrapInvoice(body);
  if (!inv) return NextResponse.json({ ok: true, ignored: "no invoice" });

  try {
    const result = await applyApiPayInvoice(inv);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // 500 — ApiPay повторит позже; это правильно, если не ответила таблица.
    console.error("kaspi webhook:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
}
