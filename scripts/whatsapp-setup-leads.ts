/*
 * Номер Земфиры (лиды с рекламы) в Green API — второй номер, только для переписки в CRM.
 * Запускает zemfira-whatsapp-key.bat после того, как владелец вписал ключи (GREENAPI_LEADS_*).
 *
 * Что делает:
 *   1. спрашивает у Green API, подключён ли номер (отсканирован ли QR-код);
 *   2. прописывает адрес уведомлений `…/api/whatsapp/webhook?line=leads` и тот же токен,
 *      что у рабочего номера (WHATSAPP_WEBHOOK_TOKEN);
 *   3. с `--import-days N` дописывает в CRM переписку за последние N дней (до 3), которой там
 *      ещё нет, — чтобы в карточках её лидов была история с первого дня.
 *
 * Ключи НЕ печатает — только «есть / нет» и длину. С номера ничего не отправляется.
 * Запуск: npx tsx scripts/whatsapp-setup-leads.ts [--import-days 3]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { setupLeadsLine } from "../src/lib/leadsLineSetup";

const SITE = "https://www.crm-ecoculture.kz";
const len = (v?: string) => (v && v.trim() ? `есть (${v.trim().length} симв.)` : "НЕТ");

async function main() {
  console.log("=== Ключи номера Земфиры ===");
  console.log(`GREENAPI_LEADS_URL:      ${process.env.GREENAPI_LEADS_URL ? process.env.GREENAPI_LEADS_URL.trim() : "нет (будет https://api.green-api.com)"}`);
  console.log(`GREENAPI_LEADS_INSTANCE: ${len(process.env.GREENAPI_LEADS_INSTANCE)}`);
  console.log(`GREENAPI_LEADS_TOKEN:    ${len(process.env.GREENAPI_LEADS_TOKEN)}`);
  const at = process.argv.indexOf("--import-days");
  const days = at >= 0 ? Number(process.argv[at + 1]) || 0 : 0;
  console.log("");
  for (const line of await setupLeadsLine(SITE, days)) console.log(line);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
