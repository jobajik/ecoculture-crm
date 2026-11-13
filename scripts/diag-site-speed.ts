import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Замер скорости с сервера сайта (переезд на базу данных, 13.11.2026): зовёт `/api/diag/speed` и печатает, в каком
 * регионе работает функция, сколько у неё занимает Google-таблица и сколько — база Neon. Ничего не меняет, секретов не
 * печатает. Нужен CRON_SECRET в .env.local.
 *
 *   npx tsx scripts/diag-site-speed.ts [раз]        — по умолчанию два замера
 *   npx tsx scripts/diag-site-speed.ts 2 --no-sheets — без чтения таблицы (только база)
 */
const BASE = "https://www.crm-ecoculture.kz";

async function timed(path: string, headers: Record<string, string> = {}) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { headers, cache: "no-store", redirect: "manual" });
  const text = await res.text();
  return { ms: Date.now() - t0, status: res.status, via: res.headers.get("x-vercel-id") || "", text };
}

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Нет CRON_SECRET в .env.local");
  const times = Math.max(1, Math.min(5, Number(process.argv[2]) || 2));
  const noSheets = process.argv.includes("--no-sheets");

  console.log("Пустой ответ сайта (/api/version), мс с этого компьютера:");
  for (let i = 0; i < 3; i++) {
    const r = await timed("/api/version");
    console.log(`  ${r.ms} мс · ${r.status} · ${r.via}`);
  }

  for (let i = 1; i <= times; i++) {
    const r = await timed("/api/diag/speed" + (noSheets ? "?sheets=0" : ""), { authorization: `Bearer ${secret}` });
    console.log(`\nЗамер ${i}: ответ за ${r.ms} мс · ${r.status} · ${r.via}`);
    if (r.status !== 200) {
      console.log("  " + r.text.slice(0, 200));
      continue;
    }
    const data = JSON.parse(r.text);
    console.log(`  версия ${data.commit}, регион функции: ${data.region || "?"}`);
    for (const s of data.sheets || []) {
      console.log(s.error ? `  таблица: ОШИБКА ${s.error}` : `  таблица · ${s.what}${s.rows !== undefined ? ` (${s.rows} строк)` : ""}: ${s.ms} мс`);
    }
    for (const kind of ["pooled", "direct"]) {
      const d = data.db?.[kind];
      if (!d?.set) {
        console.log(`  база · ${kind}: строка не задана`);
        continue;
      }
      const head = `  база · ${kind} (${d.neon ? "Neon" : "не Neon"}, ${d.region || "регион ?"}, ${d.pooled ? "с пулом" : "прямое"})`;
      console.log(d.ok ? `${head}: соединение ${d.connectMs} мс, запросы ${d.queryMs.join(" / ")} мс · PostgreSQL ${d.version}, база ${d.db}, таблиц ${d.tables}` : `${head}: ОШИБКА ${d.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
