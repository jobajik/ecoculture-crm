import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * «Решения ИИ» без браузера: зовёт `/api/leads/decide` с CRON_SECRET, пока сайт не скажет, что
 * разбирать больше нечего (не больше `--max` проходов, по умолчанию 40). Каждый проход — до 12 лидов
 * за ~45 с; ключи Green API Земфиры и OpenAI — на сайте. Печатает ответы сайта.
 *   npx tsx scripts/leads-decide-run.ts [--max 40]
 */
const SITE = "https://www.crm-ecoculture.kz";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Нет CRON_SECRET в .env.local");
  const at = process.argv.indexOf("--max");
  const max = at >= 0 ? Number(process.argv[at + 1]) || 40 : 40;
  let total = 0;
  let idle = 0;
  for (let i = 1; i <= max; i++) {
    const res = await fetch(`${SITE}/api/leads/decide`, { headers: { authorization: `Bearer ${secret}` } });
    const text = await res.text();
    console.log(`--- проход ${i} (${res.status}) ---\n${text}`);
    if (!res.ok) {
      if (++idle >= 3) break;
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    const body = JSON.parse(text) as { done: number; left: number; queue: number };
    total += body.done;
    if (body.left <= 0) break;
    idle = body.done === 0 ? idle + 1 : 0;
    if (idle >= 3) break;
  }
  console.log(`\nИтого разобрано: ${total}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
