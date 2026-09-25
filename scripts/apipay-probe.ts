/*
 * Какие поля ApiPay ждёт при создании счёта. Шлёт ЗАВЕДОМО НЕВЕРНЫЕ запросы (сумма 0),
 * поэтому счёт не создаётся никогда; печатает только, на какие поля ApiPay пожаловался.
 * Ключ не печатается. Запуск: npx tsx scripts/apipay-probe.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { APIPAY_BASE, apiPayConfig } from "../src/lib/apipay";

async function probe(label: string, body: Record<string, unknown>) {
  const cfg = apiPayConfig("esentai");
  if (!cfg) {
    console.log("Ключа Есентая нет");
    return;
  }
  const res = await fetch(`${APIPAY_BASE}/invoices`, {
    method: "POST",
    headers: { "X-API-Key": cfg.key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`--- ${label}: ${res.status}\n${text.slice(0, 1500)}`);
}

async function main() {
  await probe("phone_number, сумма 0", { phone_number: "87000000000", amount: 0 });
  await probe("client_phone, сумма 0", { client_phone: "87000000000", amount: 0 });
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
