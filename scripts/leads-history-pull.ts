import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Дотянуть полную переписку чатов Земфиры (её ключи только на сайте) — зовёт `/api/whatsapp/leads-setup?history=1`
 * с CRON_SECRET, пока сайт пишет «Осталось N чатов» (не больше `--max` раз, по умолчанию 5). Печатает ответ сайта.
 *   npx tsx scripts/leads-history-pull.ts [--max 5]
 */
const SITE = "https://www.crm-ecoculture.kz";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Нет CRON_SECRET в .env.local");
  const at = process.argv.indexOf("--max");
  const max = at >= 0 ? Number(process.argv[at + 1]) || 5 : 5;
  for (let i = 1; i <= max; i++) {
    const res = await fetch(`${SITE}/api/whatsapp/leads-setup?history=1`, { headers: { authorization: `Bearer ${secret}` } });
    const body = await res.text();
    console.log(`--- проход ${i} (${res.status}) ---\n${body}`);
    if (!res.ok || !/Осталось \d+ чатов/.test(body)) break;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
