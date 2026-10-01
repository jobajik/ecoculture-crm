/** Проверка листания периода (`src/lib/periodNav.ts`). Запуск: npx tsx scripts/check-period-nav.ts */
import { canStepForward, isCurrentRange, stepAnchor } from "../src/lib/periodNav";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : ` — получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`}`);
};

eq("месяц назад с 1 октября — 1 сентября", stepAnchor("month", "2026-10-01", -1), "2026-09-01");
eq("месяц назад с 1 января — 1 декабря прошлого года", stepAnchor("month", "2026-01-01", -1), "2025-12-01");
eq("месяц вперёд с 31-го не перескакивает через месяц", stepAnchor("month", "2026-01-31", 1), "2026-02-01");
eq("неделя назад", stepAnchor("week", "2026-09-28", -1), "2026-09-21");
eq("день назад через границу месяца", stepAnchor("day", "2026-10-01", -1), "2026-09-30");
eq("день вперёд в високосный февраль", stepAnchor("day", "2028-02-28", 1), "2028-02-29");
eq("1 октября: октябрь — текущий", isCurrentRange("2026-10-01", "2026-10-31", "2026-10-01"), true);
eq("1 октября: сентябрь — не текущий", isCurrentRange("2026-09-01", "2026-09-30", "2026-10-01"), false);
eq("из сентября вперёд можно (октябрь уже начался)", canStepForward("month", "2026-09-01", "2026-10-01"), true);
eq("из октября вперёд нельзя (ноябрь ещё не начался)", canStepForward("month", "2026-10-01", "2026-10-01"), false);
eq("из вчера вперёд можно", canStepForward("day", "2026-09-30", "2026-10-01"), true);
eq("из сегодня вперёд нельзя", canStepForward("day", "2026-10-01", "2026-10-01"), false);

if (failed) {
  console.log(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
