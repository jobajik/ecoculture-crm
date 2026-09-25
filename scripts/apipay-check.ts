/*
 * Проверка подключения ApiPay (Kaspi Pay): видит ли программа ключи и что
 * отвечает ApiPay. НИЧЕГО НЕ СОЗДАЁТ и НЕ МЕНЯЕТ. Ключи и секреты не печатает
 * никогда — только есть ли они и какой длины; поля с «key», «secret», «token»
 * в ответах вырезаются.
 *
 * Запуск: npx tsx scripts/apipay-check.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { APIPAY_BASE, apiPayConfig, apiPayGet } from "../src/lib/apipay";
import { FARMS, FARM_LABELS } from "../src/lib/constants";

function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = /key|secret|token|password|signature/i.test(k) ? "***" : redact(val, depth + 1);
    }
    return out;
  }
  return v;
}

async function main() {
  console.log(`ApiPay: ${APIPAY_BASE}`);
  const statusRes = await fetch(`${APIPAY_BASE}/status`).catch((e) => ({ ok: false, status: 0, statusText: String(e) }) as Response);
  console.log(`GET /status (без ключа): ${statusRes.status} ${statusRes.ok ? "ok" : statusRes.statusText}`);

  for (const farm of [FARMS.ESENTAI, FARMS.ROSE_FARM]) {
    const prefix = farm === FARMS.ESENTAI ? "APIPAY_ESENTAI" : "APIPAY_ROSE_FARM";
    const key = (process.env[`${prefix}_KEY`] || "").trim();
    const secret = (process.env[`${prefix}_WEBHOOK_SECRET`] || "").trim();
    console.log(`\n===== ${FARM_LABELS[farm]} =====`);
    console.log(`${prefix}_KEY: ${key ? `есть (${key.length} симв.)` : "НЕТ"}`);
    console.log(`${prefix}_WEBHOOK_SECRET: ${secret ? `есть (${secret.length} симв.)` : "нет"}`);
    const cfg = apiPayConfig(farm);
    if (!cfg) continue;
    for (const path of ["/account", "/connections", "/tariff", "/invoices?per_page=5"]) {
      try {
        const data = await apiPayGet(cfg, path);
        console.log(`GET ${path}: ok\n${JSON.stringify(redact(data), null, 1).slice(0, 2500)}`);
      } catch (e) {
        const err = e as { status?: number; code?: string; message?: string };
        console.log(`GET ${path}: ОШИБКА ${err.status ?? ""} ${err.code ?? ""} — ${err.message ?? e}`);
      }
    }
  }
  console.log("\nАдрес вебхука для кабинета ApiPay (Есентай): https://www.crm-ecoculture.kz/api/kaspi/webhook/esentai");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
