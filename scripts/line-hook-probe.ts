/*
 * Проверить, что сайт принимает адрес уведомлений номера менеджера с ключом (без токена) и не принимает без
 * ключа или с чужим. Шлёт пустое уведомление — оно ничего не записывает. Ключ не печатает.
 * Запуск: npx tsx scripts/line-hook-probe.ts <код линии>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { lineHookKey } from "../src/lib/secretBox";

async function main() {
  const code = process.argv[2] || "";
  const base = `https://www.crm-ecoculture.kz/api/whatsapp/webhook?line=${encodeURIComponent(code)}`;
  for (const [label, url] of [
    ["с ключом", `${base}&key=${lineHookKey(code)}`],
    ["без ключа", base],
    ["чужой ключ", `${base}&key=${"0".repeat(40)}`],
  ] as const) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    console.log(`${label}: ${res.status} ${(await res.text()).slice(0, 80)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
