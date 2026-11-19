import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Разбудить отправку накладных на сайте — то же, что делает расписание раз в час и склад после отгрузки
 * (`/api/waybill/run`, CRON_SECRET). Нужен, когда ждать часа не хочется: после выкладки или чтобы сразу разобрать
 * накладные, застрявшие в «отправляется». Печатает, что сайт ответил; имён и номеров клиентов в ответе нет.
 *
 *   npx tsx scripts/waybill-run.ts [сколько раз подряд = 1]
 */
const SITE = "https://www.crm-ecoculture.kz";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Нет CRON_SECRET в .env.local");
  const times = Math.min(5, Math.max(1, Number(process.argv[2]) || 1));
  for (let i = 1; i <= times; i++) {
    const res = await fetch(`${SITE}/api/waybill/run`, { headers: { Authorization: `Bearer ${secret}` } });
    const text = await res.text();
    console.log(`проход ${i}: ${res.status} ${text.slice(0, 900)}`);
    if (i < times) await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
