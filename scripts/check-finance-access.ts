/*
 * Кто видит деньги и кто их трогает.
 *
 * Владелец попросил: «добавь отслеживание оплат для РОПа, без права изменений.
 * Просто чтобы видела долги и прочее». До этого раздел «Оплаты» был закрыт от
 * РОПа целиком, и выходило странно: человек отвечает за план продаж, а узнать,
 * заплатили ли по его заявкам, мог только спросив бухгалтера.
 *
 * Проверка стережёт ровно ту границу, которую здесь легко стереть: **право
 * СМОТРЕТЬ и право ТРОГАТЬ — разные.** Дай РОПу второе заодно с первым — и за
 * неразнесённую оплату спросить будет не с кого, а расхождение с кассой придётся
 * разбирать по памяти.
 *
 * Запуск: npx tsx scripts/check-finance-access.ts
 */
import {
  canEditFinance,
  canSeeFinance,
  canSeeFinanceInternals,
} from "../src/lib/financeAccess";
import { financeTabsFor } from "../src/app/finance/tabs";
import { ROLES } from "../src/lib/constants";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

// --- Кто видит ---------------------------------------------------------------

check("бухгалтер видит", canSeeFinance(ROLES.ACCOUNTANT), true);
check("администратор видит", canSeeFinance(ROLES.ADMIN), true);
check("РОП видит — это и просил владелец", canSeeFinance(ROLES.SALES_HEAD), true);
check("менеджер не видит", canSeeFinance(ROLES.MANAGER), false);
check("зав. складом не видит", canSeeFinance(ROLES.WAREHOUSE), false);
check("менеджер розницы не видит", canSeeFinance(ROLES.RETAIL_ALMATY), false);
check("пустая роль не видит (грабли 1.10)", canSeeFinance(""), false);

// --- Кто трогает -------------------------------------------------------------
//
// Главная строка этой проверки. РОП смотрит, но не меняет.

check("РОП НЕ меняет", canEditFinance(ROLES.SALES_HEAD), false);
check("бухгалтер меняет", canEditFinance(ROLES.ACCOUNTANT), true);
check("администратор меняет", canEditFinance(ROLES.ADMIN), true);
check("менеджер не меняет", canEditFinance(ROLES.MANAGER), false);
check("пустая роль не меняет", canEditFinance(""), false);

// Видеть и трогать — разные права, и ни один, кто трогает, не должен оказаться
// вне тех, кто видит.
for (const role of Object.values(ROLES)) {
  if (canEditFinance(role)) {
    check(`${role}: кто меняет — тот и видит`, canSeeFinance(role), true);
  }
}

// --- Кадровое и служебное РОПу не показываем ---------------------------------

check("удержания и журнал — не для РОПа", canSeeFinanceInternals(ROLES.SALES_HEAD), false);
check("бухгалтеру — да", canSeeFinanceInternals(ROLES.ACCOUNTANT), true);

const ropTabs = financeTabsFor(ROLES.SALES_HEAD).map((t) => t.href);
check("вкладки РОПа", ropTabs, ["/finance", "/finance/debts", "/finance/claims", "/finance/analytics", "/finance/report"]);
check("у РОПа нет «Цветы в счёт зп»", ropTabs.includes("/finance/takeouts"), false);
check("и нет «Журнала»", ropTabs.includes("/finance/log"), false);
check("у бухгалтера все семь", financeTabsFor(ROLES.ACCOUNTANT).length, 7);
check("у администратора тоже", financeTabsFor(ROLES.ADMIN).length, 7);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
